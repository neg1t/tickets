# Backend handoff: tickets, halls, and purchase API

Дата подготовки: 2 ноября 2026
Назначение: передать backend-команде модели, HTTP-операции и серверные правила, которых ожидают редактор залов и виджет покупки.

## 1. Готовность и границы

- Во frontend уже описаны runtime-контракты Zod, TypeScript-типы, OpenAPI 3.1 и HTTP-клиенты: API редактора v1 и buyer API v2.
- OpenAPI здесь — интеграционный контракт, а не доказательство, что сервер или БД уже реализованы.
- Физическая схема БД не предписывается. Backend выбирает таблицы/документы/индексы и способы хранения файлов, сохраняя описанные ниже связи и инварианты.
- Новый виджет использует только /api/v2/buyer. Старые v1 holds/orders не покрывают сессию покупателя, OTP, quote и внешний платежный процесс.
- Создание/редактирование событий и сеансов не реализовано в текущем UI. Если это зона ответственности backend, понадобятся отдельные admin операции.
- Покупка содержит только выбранные пользователем места и количество билетов в GA-зоне. Парковки, «лучшей цены», «лучших мест» и рекомендаций нет.

Источники контракта:
- libs/api-contracts/src/contracts.ts — редактор API v1;
- libs/api-contracts/src/buyer.ts — покупательские DTO v2;
- libs/api-contracts/src/buyerGeometry.ts — публичная геометрия и block delivery;
- libs/api-contracts/src/pricing.ts и libs/domain/src/lib/pricing — каталог цен и назначения;
- libs/api-contracts/openapi.ts и openapi.json — OpenAPI;
- libs/api-axios/src/client.ts — клиент редактора;
- libs/api-axios/src/buyerClient.ts и buyerGeometryClient.ts — HTTP клиенты покупки;
- libs/ticket-purchase/src/lib/model/purchase.types.ts — интерфейс источника данных виджета;
- apps/embed/README.md — интеграция WebView и host bridge.

## 2. Связи логических сущностей

Физическая схема остаётся за backend, но нужны такие логические отношения:

    Venue
      └── Hall
            └── Layout
                  ├── Draft
                  └── Published LayoutVersion (неизменяемая)
                        └── LayoutSnapshot
                              ├── floors, zones, rows, seats, tables
                              ├── decorations
                              └── editor backgrounds/assets

    Event
      └── Occurrence
            ├── Published LayoutVersion
            ├── Inventory + availabilityRevision
            ├── PricingCatalog + pricingRevision
            └── PricingAssignments + revision

    BuyerSession
      ├── contact + contactRevision + email verification
      ├── Hold (временная бронь мест/GA quantity)
      └── Order
            ├── selection/price snapshot
            ├── Quote(s)
            ├── PaymentAttempt(s)
            └── Ticket(s) + delivery status

    IdempotencyRecord
      └── scope + key + request fingerprint + исходный ответ

Hold, order, quote, payment attempt и ticket должны быть связаны с occurrence и владельцем. Покупка хранит layoutVersionId и snapshot, на которых она создана.

## 3. Модели зала и схемы

### 3.1. Черновик

Текущий HallLayoutDraft содержит:
- schemaVersion;
- hallName;
- snapshot;
- zoneBounds;
- assets;
- calibration.

LayoutSnapshot содержит:
- id, layoutVersionId;
- floors[], zones[], rows[], seats[], tables[];
- backgrounds[], decorations[].

| Сущность | Основные данные / ограничения |
| --- | --- |
| Floor | id, layoutVersionId, name. Привязан к версии схемы. |
| Zone | id, floorId, name, kind: seated or ga, необязательный polygon. Для GA обязательна capacity > 0. |
| Row | id, floorId, необязательный zoneId, name, curve и настройки генерации. Curve: line, arc, bezier, polyline. Generation задаёт count/step, gaps/skipped slots, нумерацию и ручные поправки мест. |
| Seat | id, floorId, необязательный zoneId, label, world position, placement: standalone, row or table; опционально slotKey, visualKind, rotation, manual adjustment. |
| Table | id, floorId, необязательный zoneId, label, center, rotation, shape: circle or rectangle и настройки генерации мест. |
| Decoration | stage, obstacle или label; всегда привязана к floor. |
| Background | редакторская подложка PDF/image: asset ref, страница, позиция, масштаб, rotation, opacity, visible/locked. |
| Calibration | millimetersPerWorldUnit для пересчёта расстояний. |
| zoneBounds | map zoneId → bounds для фокуса на секторе/GA зоне. |

Координаты world units: начало сверху-слева, Y растёт вниз; углы в радианах. PDF coordinates имеют начало снизу-слева и преобразуются редактором.

Сервер повторяет проверки snapshot:
- ID уникальны внутри каждой коллекции;
- floor/zone/родительский row или table существуют и принадлежат этому snapshot/version;
- место, связанное с row/table, не может относиться к другому floor; zone места и родителя при наличии должна совпадать;
- row/table/seat/decoration/background ссылаются только на существующий floor;
- GA-zone имеет положительную capacity;
- bounds конечны и упорядочены.

Не генерировать новые seat IDs при обычном редактировании/публикации. ID связывает место с ценой, inventory, hold, заказом и проданным билетом. Публикация не должна удалить ID места, по которому уже есть продажа.

### 3.2. Draft и immutable versions

LayoutVersion содержит id, layoutId, versionNumber, revision, snapshotId, calibration, status draft|published|archived и timestamps.

Правила:
1. PUT draft проверяет ожидаемую revision; при конфликте возвращает currentRevision.
2. Сохранение создаёт новый snapshotId и увеличивает draft revision.
3. Validate возвращает issues с severity=error|warning, code, message, optional targetId.
4. Publish блокируется при errors; warnings требуют warningsAcknowledged=true.
5. Publish создаёт новый immutable layoutVersionId/snapshot и увеличивает versionNumber. Опубликованную версию не переписываем.
6. Occurrence явно ссылается на layoutVersionId. Смена схемы не изменяет существующие holds/orders/tickets.
7. Удаление зала/версии запрещено или архивируется, если на неё ссылаются продажи, occurrence или история.

### 3.3. Публичная геометрия

Buyer получает не draft:
- backgrounds пустые: не выдавать PDF/image подложки, data URL и editor blobs;
- отдавать публичную геометрию floors/zones/rows/seats/tables/decorations, hallName и zoneBounds;
- availability и цены выдаются отдельными revisioned ресурсами.

Для больших залов описан geometry manifest:
- occurrenceId, layoutVersionId, schemaVersion=1, общий bounds;
- overview с bounds/floors/zones;
- blocks с id, floorId, optional sectorId, bounds и asset {HTTPS url, byteLength, sha256};
- block содержит rows/seats/tables/decorations одного floor; ссылки seat→row/table находятся внутри того же блока.

Клиент уже имеет DTO manifest/block и SHA-256 проверку, но пока загружает полный seat-map. Manifest/block — этап масштабирования, не обязательный для первой версии небольших схем.

## 4. Occurrence, доступность и цены

### 4.1. Occurrence

Доменная модель occurrence сейчас минимальна: id, eventId, layoutVersionId, startsAt. Покупателю также нужны:
- title, startsAt, IANA timeZone;
- venue.name, venue.city, optional address;
- optional poster {url, alt};
- salesStatus=open|not_yet_open|sold_out|closed;
- currency;
- capabilities.seats и capabilities.generalAdmission.

Buyer context дополнительно отдаёт layoutVersionId, availabilityRevision, pricingRevision, serverTime, ownHold и capabilities {promoCode, emailVerification, paymentMode=redirect|native|none}. Не вычислять timeZone и статус продаж из timezone устройства.

### 4.2. Inventory

Физическая модель:
- seat status: available|held|sold|blocked|unavailable;
- GA-zone: capacity, held, sold, blocked;
- held + sold + blocked ≤ capacity.

Buyer API отдаёт revision и:
- seatId → status;
- zoneId → {available, maxPerOrder?}.

Один seat нельзя одновременно продать/зарезервировать двум покупателям; GA остаток не может уйти ниже нуля. Изменения availability имеют монотонные revisions. Delta содержит baseRevision/revision; цепочка contiguous. Если клиент отстал — вернуть resyncRequired=true без changes и дать перечитать полный ресурс.

Widget сейчас опрашивает availability примерно раз в 5 секунд и при возвращении из background/online. SSE/WebSocket для первого подключения не требуется.

### 4.3. Pricing

PricingCatalog:
- occurrenceId, revision;
- items: id, name, color, status=active|archived, price {amountMinor, currency}.

PricingAssignments:
- schemaVersion=1, occurrenceId, layoutVersionId;
- revision, catalogRevision;
- seatSegments: {seatId: segmentId};
- gaZoneSegments: {zoneId: segmentId}.

Проверки:
- назначаются только seats/GA zones нужной layout version;
- только существующие активные segments;
- occurrence/layout/catalog revisions должны совпадать;
- смешивание валют запрещено.
BuyerPrices содержит occurrenceId, layoutVersionId, pricingRevision, currency и maps prices для seats/zones: {amountMinor, category?}. Все суммы — integer minor units, валюта ISO-4217; клиентская сумма не авторитетна.

## 5. Покупательские модели

| Модель | Назначение |
| --- | --- |
| BuyerSelection | seat: {kind, seatId}; GA: {kind, zoneId, quantity}. При резерве список непустой, без повторов. |
| BuyerSession | purchaseSessionId, секретный credential, occurrenceId, expiresAt; contact/contactRevision, email verification, ownHold, active order/payment. |
| BuyerContact | firstName, lastName, phone, email. Сохранён в session; смена email сбрасывает verification. |
| OTP Challenge | challengeId, destinationMasked, codeLength, expiresAt, resendAvailableAt, attemptsRemaining. Код никогда не возвращать клиенту. |
| BuyerHold | id, ownerSessionId, occurrenceId, layoutVersionId, revision, expiresAt, serverTime, selection, authoritative lineItems/total/currency, availabilityRevision, status active, expired, cancelled or converted. |
| BuyerLineItem | label, quantity, unitPriceMinor, totalMinor; total = quantity × unit price. |
| BuyerQuote | quoteId, orderId, revision, expiresAt, currency, lines, ticket subtotal, discount, service fee, commission, total и promo status/code. |
| BuyerOrder | id, occurrence/layout version, revision, holdId, quoteId, contactRevision, selection/lines/currency, order/payment/delivery statuses, createdAt. |
| BuyerPaymentAttempt | id, orderId, status, action: redirect URL, native provider payload or none. Payload не содержит исполняемый код. |
| BuyerTicketSummary | ticketId, orderId, occurrenceId, display labels, deliveryStatus и optional short-lived open URL + expiresAt. |
| BuyerSessionResume | session/occurrence IDs, contact, contactRevision, emailVerification, ownHold, activeOrder, activePaymentAttempt, serverTime. Неизвестные/отсутствующие сущности nullable. |

Quote invariants:
- ticketsSubtotalMinor = сумма line items;
- totalMinor = ticketsSubtotalMinor - discountMinor + serviceFeeMinor + commissionMinor;
- все суммы — безопасные integer minor units, discount не превышает subtotal, total неотрицательный;
- backend сам пересчитывает line items/total; значения от UI не доверять.

Order, payment и delivery — разные состояния:
- order: pending|payment_pending|confirmed|cancelled|expired|failed;
- payment: not_started|pending|paid|failed|cancelled|refunded;
- delivery: pending|issued|partial|failed;
- payment attempt: created|action_required|processing|succeeded|failed|cancelled|expired.
Оплата может быть paid, пока билет ещё pending.

## 6. Buyer HTTP API v2

Это API вызывает текущий PurchaseDataSource/HTTP adapter. Точный OpenAPI находится в libs/api-contracts/openapi.json.

### Чтение события и выбор билетов

| Метод и путь | Ответ/поведение |
| --- | --- |
| GET /api/v2/buyer/events/{eventId}/occurrences?cursor= | Occurrence summaries и pagination; не грузить схемы всех залов в списке. |
| GET /api/v2/buyer/occurrences/{id}/context | Контекст occurrence и ownHold текущей сессии. |
| GET /api/v2/buyer/occurrences/{id}/seat-map | Полная public geometry обычного зала. |
| GET /api/v2/buyer/occurrences/{id}/geometry-manifest | Immutable manifest/overview для больших залов. |
| GET /api/v2/buyer/geometry/{layoutVersionId}/blocks/{blockId} | Immutable geometry block, возможно через CDN/object storage. |
| GET /api/v2/buyer/occurrences/{id}/availability | Seat/GA inventory и revision. |
| GET /api/v2/buyer/occurrences/{id}/availability-changes?sinceRevision= | Непрерывные изменения или full resync. |
| GET /api/v2/buyer/occurrences/{id}/prices | Авторитетные цены/ревизия. |
| POST /api/v2/buyer/occurrences/{id}/holds | Атомарно проверяет версии/остаток/лимиты и создаёт hold. |
| GET /api/v2/buyer/holds/{id} | Прочитать hold только владельцу, включая terminal state. |
| DELETE /api/v2/buyer/holds/{id} | Отменить свой hold и освободить inventory; If-Match по hold revision. |

### Покупательская сессия и оформление

| Метод и путь | Ответ/поведение |
| --- | --- |
| POST /api/v2/buyer/sessions | Создать guest session либо обменять hostBootstrapCredential; вернуть session ID, credential и expiry. |
| GET /api/v2/buyer/sessions/current/resume | Восстановить контакт, hold, order/payment и serverTime после reload/WebView resume. |
| PUT /api/v2/buyer/sessions/current/contact | Сохранить контакт по contactRevision; изменившийся email сбрасывает verification. |
| POST /api/v2/buyer/sessions/current/email-challenges | Отправить OTP, вернуть только метаданные challenge; ограничить resend. |
| POST /api/v2/buyer/email-challenges/{id}/verify | Проверить code, attempts и expiry; вернуть session contact/emailVerification. |
| POST /api/v2/buyer/orders | Создать или восстановить один order из собственного активного hold и contactRevision. |
| GET /api/v2/buyer/orders/{id} | Актуальное состояние order/payment, только владелец. |
| POST /api/v2/buyer/orders/{id}/quotes | Рассчитать quote, проверить promo, вернуть breakdown/revision/expiry. |
| POST /api/v2/buyer/orders/{id}/checkout | Проверить quote/order revisions и verification; создать/возобновить payment attempt. |
| GET /api/v2/buyer/orders/{id}/tickets | Билеты заказа и delivery state; ссылка только владельцу и с expiry. |

Ключевые request payloads:

Создание сессии:

    {
      "apiVersion": "v2",
      "occurrenceId": "occurrence-42",
      "hostBootstrapCredential": "optional-single-use-host-token"
    }

Создание hold:

    {
      "apiVersion": "v2",
      "layoutVersionId": "layout-v8",
      "availabilityRevision": 17,
      "pricingRevision": 4,
      "selection": [
        { "kind": "seat", "seatId": "seat-42" },
        { "kind": "generalAdmission", "zoneId": "zone-parterre", "quantity": 2 }
      ]
    }

Hold response включает id, ownerSessionId, occurrenceId, layoutVersionId, revision, expiresAt, serverTime, selection, lineItems, totalMinor, currency, availabilityRevision и status.

Quote принимает orderRevision и необязательный promoCode. Передача null очищает текущий код. Checkout принимает quoteId, quoteRevision, orderRevision. Клиент не отправляет цены/fees/total.

## 7. API редактора и администрирования v1

Текущий API клиент редактора вызывает:

| Метод и путь | Назначение |
| --- | --- |
| GET /api/v1/halls | Список залов и краткая статистика/revision. |
| POST /api/v1/halls | Создать зал с первым draft из DraftWrite; Idempotency-Key. |
| GET /api/v1/halls/{id} | Получить hall record/draft. |
| DELETE /api/v1/halls/{id} | Удалить безопасный hall при совпадении revision; If-Match + Idempotency-Key. |
| GET /api/v1/layouts/{id}/draft | Прочитать draft. |
| PUT /api/v1/layouts/{id}/draft | Заменить draft с optimistic concurrency; If-Match + Idempotency-Key. |
| POST /api/v1/layouts/{id}/validate | Проверить draft, вернуть issues, не менять published version. |
| POST /api/v1/layouts/{id}/publish | Атомарно сохранить draft и создать immutable version; If-Match + Idempotency-Key. |
| GET /api/v1/layouts/{id}/versions | История опубликованных версий. |
| GET /api/v1/layout-versions/{id} | Одна immutable published version. |
| POST /api/v1/assets/upload-intents | Временный upload URL для PDF по имени, размеру и SHA-256. |
| POST /api/v1/assets/{id}/complete | Подтвердить загрузку/проверить байты. |
| GET /api/v1/assets/{id} | Авторизованные asset metadata. |
| DELETE /api/v1/assets/{id} | Удалить неиспользуемый asset. |
| GET /api/v1/occurrences/{id}/pricing-segments | Прочитать pricing catalog. |
| GET /api/v1/occurrences/{id}/pricing-assignments | Прочитать assignments для layout version. |
| PUT /api/v1/occurrences/{id}/pricing-assignments | Атомарно заменить assignments; If-Match + Idempotency-Key. |

Ещё есть v1 read методы /api/v1/occurrences, /{id}, /seat-map, /availability и /prices. V1 holds/orders/checkout оставлены для совместимости; новый widget должен подключаться к buyer v2.

## 8. Серверные транзакции и безопасность

Это серверная ответственность, не клиентские проверки:

1. Hold атомарно резервирует весь selection либо ничего. Проверяются владелец/session, occurrence, layoutVersionId, availabilityRevision, pricingRevision, sales status, maxPerOrder и остаток.
2. Конкурентные hold не могут продать один seat дважды или превысить GA capacity. Expiry/cancel освобождает inventory только один раз.
3. По expired hold нельзя создать order или платить. После expiry нужно перечитать inventory и получить новый hold.
4. Order сохраняет snapshot выбранных позиций, labels, цен, currency, layout version и контактной revision. Поздняя редактура схемы/цен не переписывает историю.
5. Quote привязан к order revision, сроку действия, ценам и promo result. Checkout отклоняет устаревший quote. Новая сумма требует нового quote и подтверждения пользователя.
6. Не держать DB-транзакцию на время внешней оплаты. Согласовать inventory lease для payment_pending и поздний webhook после освобождения мест.
7. Только подписанный provider webhook/серверный reconcile меняет payment state на paid. Возврат/deep link от host лишь запускает GET order/resume.
8. Повтор checkout с тем же ключом/телом возвращает тот же payment attempt. Повтор с иным payload даёт conflict.
9. Каждая mutation принимает Idempotency-Key. Тот же ключ и fingerprint → исходный ответ; другой body → idempotency_conflict.
10. Revision mutation проверяет If-Match или revision в теле. При конфликте вернуть currentRevision; frontend перечитывает данные и повторяет как новую операцию с новым ключом.
11. purchaseSessionId — selector, не credential. Backend проверяет credential и владельца session/hold/order/challenge/ticket.
12. Текущий buyer client отправляет X-Purchase-Session-Id и при наличии Authorization: Bearer sessionCredential. Не класть секрет в URL, localStorage, telemetry или логи.
13. Согласовать host token exchange/refresh либо защищённую cookie с CSRF; third-party cookies нельзя считать доступными.
14. OTP одноразовый, ограниченный по времени/попыткам/rate; код никогда не логировать или возвращать. Изменение email отзывает прежнюю верификацию.
15. Buyer endpoints не раскрывают draft assets, чужие контакты, credentials и приватные ticket URLs.
16. Geometry block bytes сверяются с manifest byteLength и sha256; публичные URLs только HTTPS.

BuyerError: apiVersion, code, message, optional fieldErrors[{path,message}], retryAfterMs, currentRevision. Коды v2 включают validation_failed, unauthorized, forbidden, not_found, revision_conflict, availability_conflict, idempotency_conflict, hold_expired, rate_limited, service_unavailable, session_expired, sales_closed, price_changed, quote_expired, invalid_promo, verification_required, invalid_code, code_expired, payment_failed, layout_version_conflict.

AbortSignal/timeout на frontend не отменяет mutation, уже принятую сервером. При неизвестном результате клиент повторяет тот же body с тем же Idempotency-Key, затем вызывает resume/read.

## 9. Разрывы контракта и вопросы backend

1. Согласовать buyer v2 как целевой контракт; замечания backend внести в Zod/OpenAPI и синхронизировать openapi.json.
2. Определить канонические Venue/Event/Occurrence и источник title, city/address, poster, timezone, salesStatus, currency, capabilities. Сейчас rich buyer summary задан, но админ-модель Event/Venue минимальна.
3. В API HallRecord нет отдельного venueId/layoutId, хотя domain Hall/Layout их содержат. Сейчас HallRecord.id должен совпадать с draft.snapshot.id. Согласовать эту модель идентичности до проектирования хранилища.
4. В редакторе нет Event/Occurrence create/update/archive. Уточнить, предоставляет ли это существующая CMS; если нет — определить admin endpoints.
5. Сегменты каталога можно читать, assignments редактировать, но создавать/менять/archive pricing segments через текущий UI/API нельзя. Определить владельца CRUD.
6. Нет inventory admin endpoints для block/unblock seat и изменения GA capacity. Уточнить, какая административная система меняет остатки и availabilityRevision.
7. Asset upload mismatch: upload-intents/complete уже описаны, но DraftWrite всё ещё несёт PDF dataUrl в HallLayoutDraft.assets, а текущий editor client отправляет draft целиком. До production выбрать один путь: upload → asset reference в draft → авторизованный read URL/bytes. Уточнить limits/signing и поддержку image assets. Не внедрять два параллельных способа.
8. Выбрать OTP/e-mail provider, длину/expiry/cooldown, rate limits, attempts и защиту от enumeration.
9. Определить session lifetime, refresh/bootstrap TTL и credential flow отдельно для browser, iframe, WebView.
10. Определить hold TTL и inventory lease при payment_pending, включая позднюю успешную оплату.
11. Определить payment provider(s), redirect/deep links, webhook signing/idempotency, refunds и cancellation.
12. Определить commission/service fee/taxes, currency exponent/minor units, quote TTL и promo rules.
13. Определить выдачу билета, retry и срок открытия ticket URL; API умеет показать pending/partial/failed, генерация билета серверная.
14. Geometry manifest/chunks — последующий этап: frontend пока не подключил lazy loading, поэтому для малого зала достаточно full seat-map.
15. Определить архивирование и удаление hall/version при существующих occurrences, holds, orders, tickets.

## 10. Рекомендуемый порядок реализации

### P0 — настоящий checkout
1. Согласовать auth/session, ошибки, idempotency и revision.
2. Buyer occurrence list/context, public map, availability и prices.
3. Атомарный hold, get/cancel, delta/resync.
4. Session resume, contact, OTP/verify.
5. Order, quote/promo, checkout/payment attempt, webhook reconcile, ticket delivery.
6. Прогнать frontend HTTP client against staging по positive/negative examples из OpenAPI.

### P1 — редактор и администрирование
1. Hall/draft create/read/save/delete с revision/idempotency.
2. Validation + атомарная immutable публикация + versions.
3. Единый asset upload/read/delete flow.
4. Pricing catalog/assignment управление или интеграция существующего сервиса.
5. Event/Occurrence admin endpoints, если CMS не предоставляет их.

### P2 — крупные залы
1. Geometry manifest/block API и versioned object storage/CDN.
2. Подключить lazy loading на frontend после backend готовности.
3. Проверить реальный размер схем. Наличие DTO/endpoints само по себе не доказывает поддержку 50k.

## 11. Критерии интеграции

- HTTP ответы проходят текущие Zod schemas без несовместимых преобразований; openapi.json синхронизирован с openapi.ts.
- Конкурентные резервирования, expiry и повторы provider webhook не создают двойных продаж/заказов/оплат.
- Reload/WebView resume восстанавливают состояние через session resume и GET order; paid подтверждает сервер.
- API проверяет ownership всех приватных ресурсов и не раскрывает editor assets/credentials/OTP.
- Есть общие backend/frontend примеры: seat и GA, conflict, expiry, quote change, invalid/expired OTP, payment pending, ticket pending.
- В таблицах/коллекциях backend может использовать любую удобную структуру, сохраняя эти logical entities и invariants. Это не инструкция по конкретной SQL-схеме.
