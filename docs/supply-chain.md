# SBOM и артефакты релиза

## Что входит в SBOM

Каждый tag `v<VERSION>` создаёт SPDX 2.3 JSON. В нём перечислены:

- сама панель и её версия из `VERSION`;
- все production-зависимости npm из `panel/package-lock.json`, включая purl и SHA-512 integrity;
- каждый закреплённый бинарный asset Caddy, Mita, Mieru client, Hysteria2, Xray, wgcf и OpenFlux;
- архитектура, точный release URL, исходный репозиторий и SHA-256 каждого внешнего asset.

SBOM не утверждает лицензию, если она не закреплена и не проверена в manifest: вместо догадки
используется стандартное SPDX-значение `NOASSERTION`. Для OpenFlux указана известная
`GPL-3.0-only`.

## Источник истины и защита от рассинхронизации

`supply-chain/components.json` — проверяемый release-manifest. Тест `tests/sbom.test.js`
сопоставляет каждую версию и checksum с production-установщиками. Изменить бинарник только в
одном месте и получить зелёный CI нельзя. Генератор `tools/generate-sbom.js` не обращается к сети,
не исполняет package scripts и получает npm-состав только из lockfile.

Локальная генерация:

```bash
node tools/generate-sbom.js dist/vertaflux.spdx.json
node tests/sbom.test.js
```

## Публикация

Workflow `Release artifacts` запускается только для tag `v*` и требует точного совпадения tag с
`VERSION`. Он создаёт исходный tar.gz, SPDX SBOM и `SHA256SUMS`, затем прикладывает их к GitHub
Release. Загрузка выполняется без `--clobber`: существующий файл той же версии не заменяется
молча.

Архив, SBOM и `SHA256SUMS` подписываются keyless-подписью Sigstore. Рядом с каждым файлом
публикуется `<имя>.sigstore.json`: bundle содержит краткоживущий сертификат GitHub Actions,
подпись и доказательство transparency log. Долгоживущий приватный ключ или repository secret
проекту не нужен. Workflow сам проверяет созданные bundle до публикации.

Пример проверки скачанного архива (подставьте фактическую версию вместо `<версия>`):

```bash
sigstore verify identity "Panel-Naive-Mieru-<версия>.tar.gz" \
  --bundle "Panel-Naive-Mieru-<версия>.tar.gz.sigstore.json" \
  --cert-identity "https://github.com/arivano81/Panel-Naive-Mieru/.github/workflows/release.yml@refs/tags/v<версия>" \
  --cert-oidc-issuer "https://token.actions.githubusercontent.com"
sha256sum -c SHA256SUMS
```

Проверяйте точное имя workflow и tag в `--cert-identity`: одна лишь валидная подпись другого
GitHub-проекта не подтверждает происхождение нашего релиза.

## Аудит Go-бинарников

Workflow `Pinned Go binary vulnerability audit` раз в неделю, вручную и при изменении manifest
скачивает точные linux-amd64 assets всех внешних Go-компонентов. До анализа каждый файл проходит
SHA-256 из `supply-chain/components.json`; архивы распаковываются, а фактически поставляемый
бинарник проверяется закреплённым `govulncheck v1.8.0` на Go 1.26.4 в binary mode. Это охватывает Caddy,
Mita, Mieru client, Hysteria2, Xray, wgcf и OpenFlux и не доверяет текущей ветке upstream.

Для каждого release manifest также хранит полный 40-символьный upstream commit. Второй проход
скачивает именно этот commit, сверяет `HEAD` и запускает source-mode `govulncheck ./...` для
каждого Go module. Он строит call graph и помогает отличить достижимый путь от символа, который
лишь присутствует в скомпилированном файле. Source scan выполняется даже после красного binary
scan; оба набора отчётов попадают в один audit artifact.

Отчёты с embedded Go build metadata и результатом проверки сохраняются в GitHub Actions на
30 дней даже при ошибке. Наличие уязвимого символа делает job красным: обновление версии или
документированный VEX должны пройти обычные checksum, SBOM и canary gate. Binary mode не строит
полный call graph: finding доказывает присутствие символа в поставляемом файле, но сам по себе
не доказывает, что конкретный путь вызывается конфигурацией панели. Поэтому findings нельзя
молча игнорировать, но их эксплуатационность требует отдельного анализа.

Для линейки 1.x принято осознанное временное ограничение: проект ставит
последние доступные проверенные upstream-бинарники, но не пересобирает их. Findings
остаются открытыми и не скрываются allowlist. Собственные воспроизводимые
security-сборки запланированы для 2.0/3.0.

Каждый artifact также содержит `summary.md` и `summary.json`: они объединяют binary/source
результаты, считают уникальные GO advisory ID и явно отмечают общий source scan Mita/Mieru.
Сводка только повышает наблюдаемость и не подавляет findings.

### Контрольный аудит 10 ноября 2026

Production-запуск [№ 42789108590](https://github.com/arivano81/Panel-Naive-Mieru/actions/runs/42789108590)
проверил точные артефакты текущего manifest после обновления Caddy и Xray. Число findings
существенно уменьшилось, но gate обоснованно остался красным, пока binary advisory не закрыты:

| Компонент | Версия | Go toolchain | Binary advisory | Source-reachable advisory |
|---|---:|---:|---:|---:|
| Caddy forwardproxy-naive | v2.11.7-naive2 | go1.26.9 | 11 | 0 |
| Mita | 3.38.0 | go1.25.14 | 56 | 23 |
| Mieru client | 3.38.0 | go1.25.14 | 56 | 23 (общий scan с Mita) |
| Hysteria2 | app/v2.12.3 | go1.26.8 | 23 | 20 |
| Xray-core | v26.11.9 | go1.27.3 | 2 | 0 |
| wgcf | 2.3.0 | go1.27.0 | 17 | 18 |
| OpenFlux | v0.17.1 | ожидает повторного audit | ожидает повторного audit | ожидает повторного audit |

Значения — количество уникальных GO advisory ID, а не число строк или stack traces. Разница
между binary и source ожидаема: binary mode видит скомпилированные символы, source mode строит
call graph отдельных Go modules. Ни один результат не получил автоматического VEX.

Обновление сняло все source-reachable findings Caddy и Xray и сократило их binary findings
соответственно с 87 до 11 и с 74 до 2. OpenFlux переведён на checksum-pinned v0.17.1;
его новые результаты фиксируются следующим audit-run после data-plane canary. Красный audit намеренно сохранён как
release blocker; allowlist по количеству или общая маска `GO-*` не добавляются.

## Откат

SBOM не участвует в runtime и не меняет сервер. Ошибка генерации блокирует только release job.
Для исправления создаётся новый commit/tag; уже опубликованный артефакт не перезаписывается.
