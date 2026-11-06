use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_fs::FsExt;

const MAX_WORKSPACE_FILES: usize = 5_000;
const MAX_SEARCH_RESULTS: usize = 500;
const MAX_SEARCH_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_DIRECTORY_DEPTH: usize = 24;
static NEXT_DOCUMENT_WINDOW_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct OpenedFiles(Mutex<Vec<String>>);

#[derive(Default)]
struct OpenedTargets(Mutex<Vec<OpenTarget>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenTarget {
    path: String,
    kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceNode {
    name: String,
    title: Option<String>,
    path: String,
    relative_path: String,
    is_directory: bool,
    children: Vec<WorkspaceNode>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSnapshot {
    root: String,
    name: String,
    entries: Vec<WorkspaceNode>,
    file_count: usize,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchMatch {
    path: String,
    relative_path: String,
    name: String,
    line: usize,
    snippet: String,
    match_kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentMetadata {
    path: String,
    modified_ms: u64,
    len: u64,
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "md" | "markdown"
                    | "mdown"
                    | "mkd"
                    | "txt"
                    | "json"
                    | "yaml"
                    | "yml"
                    | "toml"
                    | "csv"
                    | "log"
                    | "js"
                    | "jsx"
                    | "mjs"
                    | "cjs"
                    | "ts"
                    | "tsx"
                    | "css"
                    | "html"
                    | "htm"
                    | "xml"
                    | "svg"
                    | "vue"
                    | "svelte"
                    | "py"
                    | "sql"
                    | "sh"
                    | "bash"
                    | "zsh"
                    | "diff"
                    | "patch"
                    | "ini"
                    | "conf"
            )
        })
        .unwrap_or(false)
}

fn is_markdown_content_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown" | "mkd"
            )
        })
        .unwrap_or(false)
}

fn unescape_markdown_title(title: &str) -> String {
    let mut result = String::with_capacity(title.len());
    let mut chars = title.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(next) = chars.peek().copied() {
                if matches!(
                    next,
                    '\\' | '`'
                        | '*'
                        | '_'
                        | '{'
                        | '}'
                        | '['
                        | ']'
                        | '<'
                        | '>'
                        | '('
                        | ')'
                        | '#'
                        | '+'
                        | '-'
                        | '.'
                        | '!'
                        | '|'
                ) {
                    result.push(next);
                    chars.next();
                    continue;
                }
            }
        }

        result.push(ch);
    }

    result
}

fn read_document_title(path: &Path) -> Option<String> {
    if !is_markdown_content_file(path) {
        return None;
    }

    let file = fs::File::open(path).ok()?;
    let mut reader = file.take(96 * 1024);
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    let mut in_fence = false;

    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }

        let level = trimmed.chars().take_while(|value| *value == '#').count();
        if !(1..=6).contains(&level) {
            continue;
        }

        if !trimmed
            .as_bytes()
            .get(level)
            .is_some_and(|value| value.is_ascii_whitespace())
        {
            continue;
        }

        let title = trimmed[level..].trim().trim_matches('#').trim();
        if !title.is_empty() {
            return Some(unescape_markdown_title(title).chars().take(120).collect());
        }
    }

    None
}

fn is_ignored_directory(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };

    name.starts_with('.')
        || matches!(
            name.to_ascii_lowercase().as_str(),
            "node_modules"
                | "target"
                | "dist"
                | "build"
                | "coverage"
                | "vendor"
                | ".next"
                | ".cache"
        )
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn encode_query_value(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());

    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
    }

    encoded
}

fn metadata_modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default()
}

fn append_debug_log(message: impl AsRef<str>) {
    let path = std::env::temp_dir().join("markview-debug.log");
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{timestamp}] {}", message.as_ref());
    }
}

fn path_from_input(value: String) -> PathBuf {
    if value.starts_with("file://") {
        if let Ok(url) = Url::parse(&value) {
            if let Ok(path) = url.to_file_path() {
                return path;
            }
        }
    }

    PathBuf::from(value)
}

fn relative_path_string(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn canonical_workspace_root(root: String) -> Result<PathBuf, String> {
    let path = path_from_input(root);
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("폴더를 열 수 없습니다: {error}"))?;

    if !canonical.is_dir() {
        return Err("선택한 경로가 폴더가 아닙니다.".into());
    }

    Ok(canonical)
}

fn allow_workspace_access(app: &AppHandle, root: &Path) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(root, true)
        .map_err(|error| error.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(root, true)
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn scan_directory(
    root: &Path,
    directory: &Path,
    depth: usize,
    file_count: &mut usize,
    truncated: &mut bool,
) -> Result<Vec<WorkspaceNode>, String> {
    if depth > MAX_DIRECTORY_DEPTH || *file_count >= MAX_WORKSPACE_FILES {
        *truncated = true;
        return Ok(Vec::new());
    }

    let mut items = fs::read_dir(directory)
        .map_err(|error| format!("{} 폴더를 읽을 수 없습니다: {error}", directory.display()))?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    items.sort_by(|left, right| {
        let left_is_dir = left
            .file_type()
            .map(|value| value.is_dir())
            .unwrap_or(false);
        let right_is_dir = right
            .file_type()
            .map(|value| value.is_dir())
            .unwrap_or(false);
        right_is_dir.cmp(&left_is_dir).then_with(|| {
            left.file_name()
                .to_string_lossy()
                .to_ascii_lowercase()
                .cmp(&right.file_name().to_string_lossy().to_ascii_lowercase())
        })
    });

    let mut nodes = Vec::new();

    for entry in items {
        if *file_count >= MAX_WORKSPACE_FILES {
            *truncated = true;
            break;
        }

        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            if is_ignored_directory(&path) {
                continue;
            }

            let Ok(children) = scan_directory(root, &path, depth + 1, file_count, truncated) else {
                continue;
            };

            nodes.push(WorkspaceNode {
                name: entry.file_name().to_string_lossy().into_owned(),
                title: None,
                path: path_string(&path),
                relative_path: relative_path_string(root, &path),
                is_directory: true,
                children,
            });
            continue;
        }

        if !file_type.is_file() || !is_markdown_file(&path) {
            continue;
        }

        *file_count += 1;
        nodes.push(WorkspaceNode {
            name: entry.file_name().to_string_lossy().into_owned(),
            title: read_document_title(&path),
            path: path_string(&path),
            relative_path: relative_path_string(root, &path),
            is_directory: false,
            children: Vec::new(),
        });
    }

    Ok(nodes)
}

fn collect_document_paths(
    directory: &Path,
    depth: usize,
    paths: &mut Vec<PathBuf>,
) -> Result<(), String> {
    if depth > MAX_DIRECTORY_DEPTH || paths.len() >= MAX_WORKSPACE_FILES {
        return Ok(());
    }

    let mut items = fs::read_dir(directory)
        .map_err(|error| format!("{} 폴더를 읽을 수 없습니다: {error}", directory.display()))?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    items.sort_by_key(|entry| entry.file_name().to_string_lossy().to_ascii_lowercase());

    for entry in items {
        if paths.len() >= MAX_WORKSPACE_FILES {
            break;
        }

        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            if !is_ignored_directory(&path) {
                let _ = collect_document_paths(&path, depth + 1, paths);
            }
        } else if file_type.is_file() && is_markdown_file(&path) {
            paths.push(path);
        }
    }

    Ok(())
}

fn compact_snippet(value: &str, max_chars: usize) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut characters = compact.chars();
    let snippet = characters.by_ref().take(max_chars).collect::<String>();
    if characters.next().is_some() {
        format!("{snippet}…")
    } else {
        snippet
    }
}

fn canonical_parent(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "상위 폴더를 찾을 수 없습니다.".to_string())?;
    parent
        .canonicalize()
        .map_err(|error| format!("상위 폴더를 열 수 없습니다: {error}"))
}

fn ensure_inside_root(root: &Path, path: &Path) -> Result<(), String> {
    if path.starts_with(root) {
        Ok(())
    } else {
        Err("작업 폴더 밖의 경로는 변경할 수 없습니다.".into())
    }
}

fn validate_new_name(name: &str, allow_extensionless: bool) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("이름을 입력해 주세요.".into());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed == "." || trimmed == ".." {
        return Err("파일명에 사용할 수 없는 문자가 있습니다.".into());
    }
    if !allow_extensionless {
        let path = Path::new(trimmed);
        if !is_markdown_file(path) {
            return Err("지원하는 텍스트 확장자를 사용해 주세요.".into());
        }
    }
    Ok(trimmed.to_string())
}

fn resolve_workspace_target(
    root: String,
    parent: String,
    name: String,
    allow_extensionless: bool,
) -> Result<(PathBuf, PathBuf), String> {
    let root = canonical_workspace_root(root)?;
    let parent = path_from_input(parent)
        .canonicalize()
        .map_err(|error| format!("상위 폴더를 열 수 없습니다: {error}"))?;
    ensure_inside_root(&root, &parent)?;
    if !parent.is_dir() {
        return Err("상위 경로가 폴더가 아닙니다.".into());
    }
    let name = validate_new_name(&name, allow_extensionless)?;
    Ok((root, parent.join(name)))
}

fn unique_target_path(target: &Path) -> Result<PathBuf, String> {
    if !target.exists() {
        return Ok(target.to_path_buf());
    }

    let parent = target
        .parent()
        .ok_or_else(|| "상위 폴더를 찾을 수 없습니다.".to_string())?;
    let file_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "파일명을 읽을 수 없습니다.".to_string())?;
    let requested = Path::new(file_name);
    let stem = requested
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name);
    let extension = requested.extension().and_then(|value| value.to_str());

    for index in 2..1000 {
        let candidate_name = match extension {
            Some(extension) => format!("{stem} {index}.{extension}"),
            None => format!("{stem} {index}"),
        };
        let candidate = parent.join(candidate_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("사용 가능한 새 이름을 찾을 수 없습니다.".into())
}

fn allow_file_access(app: &AppHandle, path: &Path) -> Result<(), String> {
    if !is_markdown_file(path) {
        return Err("지원하지 않는 텍스트 파일 형식입니다.".into());
    }

    app.fs_scope()
        .allow_file(path)
        .map_err(|error| error.to_string())?;
    if let Some(parent) = path.parent() {
        app.asset_protocol_scope()
            .allow_directory(parent, true)
            .map_err(|error| error.to_string())?;
    } else {
        app.asset_protocol_scope()
            .allow_file(path)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn canonical_existing_document(path: String) -> Result<PathBuf, String> {
    let path = path_from_input(path);
    if !is_markdown_file(&path) {
        return Err("지원하지 않는 텍스트 파일 형식입니다.".into());
    }

    let canonical = path
        .canonicalize()
        .map_err(|error| format!("파일을 열 수 없습니다: {error}"))?;
    if !canonical.is_file() {
        return Err("선택한 경로가 파일이 아닙니다.".into());
    }

    Ok(canonical)
}

fn writable_document_path(path: String) -> Result<PathBuf, String> {
    let path = path_from_input(path);
    if !is_markdown_file(&path) {
        return Err("지원하지 않는 텍스트 파일 형식입니다.".into());
    }

    if path.exists() {
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("파일을 찾을 수 없습니다: {error}"))?;
        if !canonical.is_file() {
            return Err("선택한 경로가 파일이 아닙니다.".into());
        }
        return Ok(canonical);
    }

    let parent = path
        .parent()
        .ok_or_else(|| "상위 폴더를 찾을 수 없습니다.".to_string())?
        .canonicalize()
        .map_err(|error| format!("상위 폴더를 열 수 없습니다: {error}"))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "파일 이름을 찾을 수 없습니다.".to_string())?;

    Ok(parent.join(file_name))
}

fn handle_opened_urls(app: &AppHandle, urls: Vec<Url>) {
    let url_values = urls.iter().map(ToString::to_string).collect::<Vec<_>>();
    append_debug_log(format!("opened urls received: {}", url_values.join(", ")));

    let targets = urls
        .into_iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter_map(|path| open_target_from_path(app, path))
        .collect::<Vec<_>>();

    if targets.is_empty() {
        append_debug_log("opened urls had no supported targets");
        return;
    }

    queue_open_targets(app, targets);
}

fn open_target_from_path(app: &AppHandle, path: PathBuf) -> Option<OpenTarget> {
    let canonical = match path.canonicalize() {
        Ok(path) => path,
        Err(error) => {
            append_debug_log(format!(
                "open target canonical failed: {}: {error}",
                path.display()
            ));
            return None;
        }
    };

    if canonical.is_dir() {
        if let Err(error) = allow_workspace_access(app, &canonical) {
            append_debug_log(format!(
                "open target folder allow failed: {}: {error}",
                canonical.display()
            ));
            return None;
        }
        return Some(OpenTarget {
            path: path_string(&canonical),
            kind: "directory".into(),
        });
    }

    if canonical.is_file() && is_markdown_file(&canonical) {
        if let Err(error) = allow_file_access(app, &canonical) {
            append_debug_log(format!(
                "open target file allow failed: {}: {error}",
                canonical.display()
            ));
            return None;
        }
        return Some(OpenTarget {
            path: path_string(&canonical),
            kind: "file".into(),
        });
    }

    append_debug_log(format!("open target unsupported: {}", canonical.display()));
    None
}

fn initial_open_targets(app: &AppHandle) -> Vec<OpenTarget> {
    std::env::args_os()
        .skip(1)
        .filter(|arg| !arg.to_string_lossy().starts_with("-psn_"))
        .filter_map(|arg| open_target_from_path(app, PathBuf::from(arg)))
        .collect()
}

fn queue_open_targets(app: &AppHandle, targets: Vec<OpenTarget>) {
    let summary = targets
        .iter()
        .map(|target| format!("{}:{}", target.kind, target.path))
        .collect::<Vec<_>>()
        .join(", ");
    append_debug_log(format!("open targets accepted: {summary}"));

    if let Ok(mut opened) = app.state::<OpenedTargets>().0.lock() {
        opened.extend(targets.clone());
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("opened-targets", targets);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn take_opened_files(state: State<'_, OpenedFiles>) -> Vec<String> {
    let paths = match state.0.lock() {
        Ok(mut opened) => std::mem::take(&mut *opened),
        Err(_) => Vec::new(),
    };
    append_debug_log(format!(
        "take_opened_files returned {} path(s)",
        paths.len()
    ));
    paths
}

#[tauri::command]
fn take_opened_targets(state: State<'_, OpenedTargets>) -> Vec<OpenTarget> {
    let targets = match state.0.lock() {
        Ok(mut opened) => std::mem::take(&mut *opened),
        Err(_) => Vec::new(),
    };
    append_debug_log(format!(
        "take_opened_targets returned {} target(s)",
        targets.len()
    ));
    targets
}

#[tauri::command]
fn resolve_open_targets(app: AppHandle, paths: Vec<String>) -> Vec<OpenTarget> {
    let targets = paths
        .into_iter()
        .filter_map(|path| open_target_from_path(&app, path_from_input(path)))
        .collect::<Vec<_>>();
    append_debug_log(format!(
        "resolve_open_targets returned {} target(s)",
        targets.len()
    ));
    targets
}

#[tauri::command]
fn allow_markdown_file(app: AppHandle, path: String) -> Result<(), String> {
    allow_file_access(&app, &path_from_input(path))
}

#[tauri::command]
fn read_markdown_file(app: AppHandle, path: String) -> Result<String, String> {
    append_debug_log(format!("read_markdown_file requested: {path}"));
    let path = match canonical_existing_document(path) {
        Ok(path) => path,
        Err(error) => {
            append_debug_log(format!("read_markdown_file canonical failed: {error}"));
            return Err(error);
        }
    };
    append_debug_log(format!(
        "read_markdown_file canonical path: {}",
        path.display()
    ));
    if let Err(error) = allow_file_access(&app, &path) {
        append_debug_log(format!("read_markdown_file allow failed: {error}"));
        return Err(error);
    }
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
            let message = format!("파일을 읽을 수 없습니다: {error}");
            append_debug_log(format!("read_markdown_file read failed: {message}"));
            return Err(message);
        }
    };
    append_debug_log(format!("read_markdown_file read {} byte(s)", bytes.len()));
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
fn document_metadata(app: AppHandle, path: String) -> Result<DocumentMetadata, String> {
    let path = canonical_existing_document(path)?;
    if let Err(error) = allow_file_access(&app, &path) {
        return Err(error);
    }
    let metadata =
        fs::metadata(&path).map_err(|error| format!("파일 정보를 읽을 수 없습니다: {error}"))?;

    Ok(DocumentMetadata {
        path: path_string(&path),
        modified_ms: metadata_modified_ms(&metadata),
        len: metadata.len(),
    })
}

#[tauri::command]
fn log_debug_message(message: String) {
    append_debug_log(message);
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "열 수 없는 링크입니다.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err("지원하지 않는 링크 형식입니다.".into());
    }

    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg(parsed.as_str())
            .status()
            .map_err(|error| format!("링크를 열 수 없습니다: {error}"))?;

        return if status.success() {
            Ok(())
        } else {
            Err("링크를 열 수 없습니다.".into())
        };
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = parsed;
        return Err("이 기능은 macOS에서만 사용할 수 있습니다.".into());
    }
}

#[tauri::command]
async fn open_document_window(app: AppHandle, path: String) -> Result<(), String> {
    let path = canonical_existing_document(path)?;
    allow_file_access(&app, &path)?;

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("문서")
        .to_string();
    let label = format!(
        "document-{}",
        NEXT_DOCUMENT_WINDOW_ID.fetch_add(1, Ordering::Relaxed)
    );
    let encoded_path = encode_query_value(&path_string(&path));
    let url = WebviewUrl::App(PathBuf::from(format!("index.html?openPath={encoded_path}")));

    let window = WebviewWindowBuilder::new(&app, label, url)
        .title(format!("{file_name} - Markview"))
        .inner_size(1280.0, 840.0)
        .min_inner_size(820.0, 560.0)
        .resizable(true)
        .center()
        .build()
        .map_err(|error| format!("새 창을 열 수 없습니다: {error}"))?;

    let _ = window.show();
    let _ = window.set_focus();

    Ok(())
}

#[tauri::command]
fn write_markdown_file(app: AppHandle, path: String, contents: String) -> Result<(), String> {
    let path = writable_document_path(path)?;
    fs::write(&path, contents).map_err(|error| format!("파일을 저장할 수 없습니다: {error}"))?;
    allow_file_access(&app, &path)
}

#[tauri::command]
fn scan_workspace(app: AppHandle, root: String) -> Result<WorkspaceSnapshot, String> {
    let root = canonical_workspace_root(root)?;
    allow_workspace_access(&app, &root)?;
    let mut file_count = 0;
    let mut truncated = false;
    let entries = scan_directory(&root, &root, 0, &mut file_count, &mut truncated)?;
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| path_string(&root));

    Ok(WorkspaceSnapshot {
        root: path_string(&root),
        name,
        entries,
        file_count,
        truncated,
    })
}

#[tauri::command]
fn search_workspace(
    root: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchMatch>, String> {
    let root = canonical_workspace_root(root)?;
    let query = query.trim();
    if query.chars().count() < 2 {
        return Ok(Vec::new());
    }

    let terms = query
        .split_whitespace()
        .map(|value| value.to_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if terms.is_empty() {
        return Ok(Vec::new());
    }

    let limit = limit.unwrap_or(200).clamp(1, MAX_SEARCH_RESULTS);
    let mut paths = Vec::new();
    collect_document_paths(&root, 0, &mut paths)?;

    let mut matches = Vec::new();

    for path in paths {
        if matches.len() >= limit {
            break;
        }

        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_owned();
        let relative_path = relative_path_string(&root, &path);
        let name_lower = name.to_lowercase();

        if terms.iter().all(|term| name_lower.contains(term)) {
            matches.push(SearchMatch {
                path: path_string(&path),
                relative_path: relative_path.clone(),
                name: name.clone(),
                line: 0,
                snippet: "파일 이름이 검색어와 일치합니다.".into(),
                match_kind: "name".into(),
            });
        }

        if matches.len() >= limit {
            break;
        }

        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if metadata.len() > MAX_SEARCH_FILE_BYTES {
            continue;
        }

        let Ok(contents) = fs::read_to_string(&path) else {
            continue;
        };

        for (line_index, line) in contents.lines().enumerate() {
            if matches.len() >= limit {
                break;
            }

            let line_lower = line.to_lowercase();
            if terms.iter().all(|term| line_lower.contains(term)) {
                matches.push(SearchMatch {
                    path: path_string(&path),
                    relative_path: relative_path.clone(),
                    name: name.clone(),
                    line: line_index + 1,
                    snippet: compact_snippet(line, 180),
                    match_kind: "content".into(),
                });
            }
        }
    }

    Ok(matches)
}

#[tauri::command]
fn create_workspace_file(
    app: AppHandle,
    root: String,
    parent: String,
    name: String,
) -> Result<String, String> {
    let (_root, target) = resolve_workspace_target(root, parent, name, false)?;
    let target = unique_target_path(&target)?;
    fs::write(&target, "# 새 문서\n\n")
        .map_err(|error| format!("파일을 만들 수 없습니다: {error}"))?;
    allow_file_access(&app, &target)?;
    Ok(path_string(&target))
}

#[tauri::command]
fn create_workspace_folder(
    app: AppHandle,
    root: String,
    parent: String,
    name: String,
) -> Result<String, String> {
    let (_root, target) = resolve_workspace_target(root, parent, name, true)?;
    let target = unique_target_path(&target)?;
    fs::create_dir(&target).map_err(|error| format!("폴더를 만들 수 없습니다: {error}"))?;
    app.fs_scope()
        .allow_directory(&target, true)
        .map_err(|error| error.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(&target, true)
        .map_err(|error| error.to_string())?;
    Ok(path_string(&target))
}

#[tauri::command]
fn rename_workspace_item(
    app: AppHandle,
    root: String,
    path: String,
    name: String,
) -> Result<String, String> {
    let root = canonical_workspace_root(root)?;
    let source = PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("대상 경로를 찾을 수 없습니다: {error}"))?;
    ensure_inside_root(&root, &source)?;
    let is_dir = source.is_dir();
    let name = validate_new_name(&name, is_dir)?;
    let parent = canonical_parent(&source)?;
    ensure_inside_root(&root, &parent)?;
    let target = parent.join(name);
    if target.exists() {
        return Err("같은 이름의 파일 또는 폴더가 이미 있습니다.".into());
    }
    fs::rename(&source, &target).map_err(|error| format!("이름을 변경할 수 없습니다: {error}"))?;
    if is_dir {
        app.fs_scope()
            .allow_directory(&target, true)
            .map_err(|error| error.to_string())?;
        app.asset_protocol_scope()
            .allow_directory(&target, true)
            .map_err(|error| error.to_string())?;
    } else {
        allow_file_access(&app, &target)?;
    }
    Ok(path_string(&target))
}

#[tauri::command]
fn move_workspace_item_to_trash(root: String, path: String) -> Result<(), String> {
    let root = canonical_workspace_root(root)?;
    let target = PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("대상 경로를 찾을 수 없습니다: {error}"))?;
    ensure_inside_root(&root, &target)?;
    if target == root {
        return Err("작업 폴더 자체는 삭제할 수 없습니다.".into());
    }
    trash::delete(&target).map_err(|error| format!("휴지통으로 이동할 수 없습니다: {error}"))?;
    Ok(())
}

#[tauri::command]
fn reveal_path_in_finder(path: String) -> Result<(), String> {
    let target = path_from_input(path)
        .canonicalize()
        .map_err(|error| format!("대상 경로를 찾을 수 없습니다: {error}"))?;

    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg("-R")
            .arg(&target)
            .status()
            .map_err(|error| format!("Finder를 열 수 없습니다: {error}"))?;

        if status.success() {
            Ok(())
        } else {
            Err("Finder에서 위치를 열 수 없습니다.".into())
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = target;
        Err("이 기능은 macOS에서만 사용할 수 있습니다.".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OpenedFiles::default())
        .manage(OpenedTargets::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let targets = initial_open_targets(&app.handle().clone());
            if !targets.is_empty() {
                queue_open_targets(&app.handle().clone(), targets);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_opened_files,
            take_opened_targets,
            resolve_open_targets,
            allow_markdown_file,
            read_markdown_file,
            document_metadata,
            log_debug_message,
            open_external_url,
            open_document_window,
            write_markdown_file,
            scan_workspace,
            search_workspace,
            create_workspace_file,
            create_workspace_folder,
            rename_workspace_item,
            move_workspace_item_to_trash,
            reveal_path_in_finder
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let tauri::RunEvent::Opened { urls } = event {
                handle_opened_urls(app, urls);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::unescape_markdown_title;

    #[test]
    fn unescapes_markdown_title_punctuation() {
        assert_eq!(
            unescape_markdown_title(r"\[GRW-349] 부계정 접근 제한 PRD"),
            "[GRW-349] 부계정 접근 제한 PRD"
        );
        assert_eq!(unescape_markdown_title(r"API \#1 \| MVP"), "API #1 | MVP");
    }
}
