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
node tools/generate-sbom.js dist/rixxx-panel.spdx.json
node tests/sbom.test.js
```

## Публикация

Workflow `Release artifacts` запускается только для tag `v*` и требует точного совпадения tag с
`VERSION`. Он создаёт исходный tar.gz, SPDX SBOM и `SHA256SUMS`, затем прикладывает их к GitHub
Release. Загрузка выполняется без `--clobber`: существующий файл той же версии не заменяется
молча. Криптографическая подпись этих файлов является отдельным следующим gate ROADMAP.

## Откат

SBOM не участвует в runtime и не меняет сервер. Ошибка генерации блокирует только release job.
Для исправления создаётся новый commit/tag; уже опубликованный артефакт не перезаписывается.
