# VLESS REALITY — спецификация этапа B

Статус: opt-in профиль работает в панели; обязательная матрица из двух реализаций
закрыта 27 сентября 2026 года. Официальный Xray 26.3.27 на Windows прошёл внешний
HTTPS-тест, а официальный sing-box 1.14.2 проверил сгенерированный JSON и провёл
HTTPS-трафик через тот же REALITY-профиль на Debian 13.

## Граница изменений

- Xray устанавливается только по явному действию администратора.
- Существующая установка и обычное обновление не скачивают Xray и не открывают порт.
- Используется отдельный `xray.service`, пользователь `xray`, каталог `/etc/xray` и TCP-порт.
- Генераторы Caddy, Mieru и Hysteria2 не изменяются.
- Первый профиль — только VLESS + REALITY + Vision. XHTTP остаётся следующим этапом.

## Зафиксированный компонент

- Xray-core: `v26.3.27` (последний stable release на дату проверки).
- Asset amd64: `Xray-linux-64.zip`.
- SHA-256: `23cd9af937744d97776ee35ecad4972cf4b2109d1e0fe6be9930467608f7c8ae`.
- Источник: `https://github.com/XTLS/Xray-core/releases/tag/v26.3.27`.

Установщик не использует `latest`, сверяет SHA-256 до распаковки и отказывается
заменять рабочий бинарник или конфиг при несовпадении.

## Данные и секреты

- private key REALITY хранится только в `/etc/xray/config.json` (`0600`);
- public key и `shortId` входят в клиентскую ссылку;
- у каждого пользователя отдельный UUID, независимый от пароля Naive/Mieru;
- замена ключевой пары требует отдельного подтверждения, потому что отключает старые ссылки;
- API статуса не возвращает private key.

## Apply и откат

Путь применения использует общий порядок этапа A:

`generate → xray run -test → last-good backup → atomic replace → restart → is-active → rollback`.

CI на Debian 13 скачивает закреплённый архив, повторно проверяет checksum и версию,
генерирует X25519-пару настоящим бинарником и выполняет `xray run -test` для конфига
с canary-пользователем. Systemd/firewall и официальный Xray-клиент Windows проверены на
внешнем Debian 13 VPS. Второй клиент — официальный sing-box 1.14.2 — принят отдельно:
его архив сверен с SHA-256 из GitHub Release API, `sing-box check` принимает выдачу панели,
а HTTPS-запрос через туннель возвращает публичный адрес VPS.

## Ручной canary-install (только тестовый Debian 13)

Пока этап B не завершён, скрипт предназначен для отдельного тестового сервера без
production-пользователей. Запуск является явным согласием на установку компонента:

```bash
sudo XRAY_PORT=8443 \
  XRAY_SERVER_NAME=www.cloudflare.com \
  bash panel/scripts/install_xray.sh
```

Скрипт создаёт `/root/rixxx-xray-install-report.txt`. Private key туда не выводится.
Повторный запуск, который способен заменить ключи REALITY, блокируется; для canary-ротации
требуется явно задать `XRAY_FORCE=1`.

## Реальный WARP-canary

27 сентября 2026 года внешний Debian 13 VPS прошёл полный цикл:

1. WARP включён с автозапуском, и Xray показал Cloudflare egress-IP.
2. Сервер реально перезагружен; `wg-quick@warp`, Caddy и Xray вернулись в active.
3. Официальный Xray 26.3.27 подключился к временному VLESS REALITY-профилю; HTTP-запрос клиента вышел с того же Cloudflare IP.
4. Временный пользователь удалён, WARP штатно выключен, а конфиги, `ip rule` и UFW возвращены к исходному состоянию.

Тест закрывает WARP-часть этапа D. Reboot-canary каскада должен быть выполнен отдельно на паре Entry/Exit.

## Двухузловой reboot-canary каскада

`tests/cascade-systemd-canary.sh` превращает оставшийся внешний gate в повторяемый
трёхфазный сценарий. Он запускается на чистой Entry-ноде Debian 13, где VLESS REALITY
уже установлен, а Exit-нода имеет отдельного пользователя Mieru. Скрипт отказывается
работать поверх существующего каскада и никогда не перезагружает сервер самостоятельно.

Подготовьте root-only Xray client JSON с VLESS outbound к Entry и локальным SOCKS inbound
`127.0.0.1:19090`; проверьте права `0600`. Пароль Exit не помещайте в командную строку:

```bash
read -rsp 'Exit Mieru password: ' EXIT_PASS; echo
printf '%s\n' "$EXIT_PASS" | sudo bash tests/cascade-systemd-canary.sh prepare \
  exit.example.com 2012 2022 cascade-canary 203.0.113.20 /root/vless-canary-client.json
unset EXIT_PASS
```

Замените `203.0.113.20` на ожидаемый публичный IP Exit. `prepare` валидирует клиентский
конфиг реальным Xray, поднимает production-каскад, проводит HTTPS-запрос через VLESS и
требует совпадения egress-IP. После успешной подготовки перезагрузите только Entry:

```bash
sudo reboot
# После повторного входа:
sudo bash tests/cascade-systemd-canary.sh verify
sudo bash tests/cascade-systemd-canary.sh cleanup
```

`verify` требует новый kernel boot ID, активные и enabled Mieru/redsocks/client units,
восстановленные scoped iptables-правила и повторный настоящий VLESS-запрос через Exit.
`cleanup` разрешён только после успешной проверки и использует штатный `teardown`, не
останавливая Caddy, Mita, Hysteria2, Xray или панель. Состояние canary имеет режим `0600`
и не содержит пароль Exit.
