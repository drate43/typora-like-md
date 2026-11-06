# Markview macOS 설치 가이드

## 왜 이 메시지가 뜨나요?

다음 메시지는 앱이 손상됐다는 뜻이 아닙니다.

> Apple은 "Markview"에 사용자 Mac에 손상을 입히거나 사용자의 개인정보에 침입할 수 있는 악성 코드가 없음을 확인할 수 없습니다.

현재 Markview는 내부 배포용 빌드라 Apple 공증(notarization)을 받지 않았습니다. 그래서 macOS 보안 기능(Gatekeeper)이 처음 실행을 막을 수 있습니다.

## 설치 순서

1. Apple Silicon(M1/M2/M3/M4)용 DMG 파일 `Markview_0.7.109_aarch64.dmg`을 엽니다.

   * Intel Mac용 DMG는 요청 시 별도로 제공합니다.
2. `Markview.app`을 `Applications` 폴더로 드래그해서 복사합니다.
3. Finder에서 `응용 프로그램` 폴더를 엽니다.
4. `Markview.app`을 그냥 더블클릭하지 말고, 우클릭 또는 Control+클릭합니다.
5. `열기`를 누릅니다.
6. 경고창이 뜨면 다시 `열기`를 누릅니다.

## 우클릭 열기가 안 될 때

1. 한 번 실행을 시도해서 경고창을 띄운 뒤 `완료`를 누릅니다.
2. macOS `시스템 설정`을 엽니다.
3. `개인정보 보호 및 보안`으로 이동합니다.
4. 아래쪽 `보안` 영역에서 `Markview` 관련 메시지를 찾습니다.
5. `그래도 열기` 또는 `Open Anyway`를 누릅니다.
6. 다시 `Markview.app`을 실행합니다.

## 그래도 안 열릴 때: 터미널 명령어

아래 명령어는 `응용 프로그램` 폴더에 설치된 Markview에만 적용됩니다.

```bash
sudo xattr -rd com.apple.quarantine "/Applications/Markview.app"
```

명령어 실행 후 Mac 비밀번호를 입력합니다. 비밀번호는 화면에 표시되지 않는 것이 정상입니다.

그 다음 `응용 프로그램` 폴더에서 `Markview.app`을 다시 실행합니다.

## DMG 파일 자체가 막힐 때

DMG 파일이 `다운로드` 폴더에 있을 경우 아래 명령어를 먼저 실행합니다.

```bash
xattr -rd com.apple.quarantine "$HOME/Downloads/Markview_0.7.109_aarch64.dmg"
```

그 다음 DMG를 다시 열고 `Markview.app`을 `Applications` 폴더로 복사합니다.

## 주의사항

* 이 명령어는 신뢰한 Markview 설치 파일에만 사용하세요.

* 다른 출처에서 받은 앱에는 같은 명령어를 무작정 사용하지 마세요.

* 기존 Marklet/Markflow 버전이 이미 설치되어 있으면 `Applications` 폴더의 기존 앱을 삭제한 뒤 새 `Markview.app`을 복사하는 것이 좋습니다.
