# Покупка билетов: WebView-виджет, React-компоненты и API — план реализации

> Для исполнителя: выполнять через `superpowers:executing-plans`; отмечать пункты после проверки. Этот документ — план, реализация нового flow ещё не начата. Коммиты и push при последующей реализации требуют соответствующего разрешения пользователя.

**Дата:** 30 октября 2026 года.

**Базовая ревизия:** `f7b529f` после включения `fix/todo_29.10` в `main`.

**Цель:** одинаковый процесс покупки в мобильном WebView, на обычной веб-странице и в React-приложении, которое собирает экран из публичных компонентов библиотеки.

**Архитектура:** общий контроллер покупки, независимые UI-компоненты, готовая композиция `TicketPurchaseWidget`, тонкая оболочка `apps/embed`. Mock и HTTP-адаптеры реализуют один контракт; мост WebView занимается интеграцией с приложением. Схема зала использует существующие библиотеки рендеринга.

**Стек:** существующие React 19, TypeScript, Effector, Nx, Vite, CSS/design tokens, Zod, Axios, Canvas/WebGL, Vitest и Playwright.

## 1. Источники, границы и решения

Макеты изучены через Figma MCP: получены структура разделов, контекст дочерних экранов и их изображения.

- Desktop: https://www.figma.com/design/Kk4DG4nbjP9TfhPqDgiJCl?node-id=513-10238
- Mobile: https://www.figma.com/design/Kk4DG4nbjP9TfhPqDgiJCl?node-id=658-23776

| Состояние | Desktop node | Mobile node | Что реализовать |
| --- | --- | --- | --- |
| Выбор мест | `564:10857` | `659:3115` | Карточка события, дата/сеанс, легенда, наша интерактивная схема, выбранные билеты, итог, продолжение |
| Контакты | `564:11235` | `659:3555` | Имя, фамилия, телефон, email, возврат, таймер подтверждённого резерва |
| Оплата | `564:11627` | `1174:28837` | Состав заказа, промокод, серверная разбивка суммы, действие оплаты |
| Промокод: введён/применён | `1851:27371`, `1851:27112` | `1174:29080`, `1174:29215`, `1174:29352` | Ввод, ожидание, успех и ошибка; текстовые состояния mobile уточнить по дочерним Fields при реализации |
| Резерв истёк | `868:14113`, `1182:24932` | Отдельный экран не задан | Баннер и доступный диалог; мобильный вариант на тех же компонентах |
| Email-код | `1105:17753`, `1105:17780` | Отдельный экран не задан | Пять ячеек в референсе; длина и повторная отправка определяются сервером |
| Успех | `868:14329` | `1174:29527` | Подтверждение серверного статуса, «История заказов», «Открыть билет» |

Требования пользователя имеют приоритет над референсом:

- Не включать header/footer сайта, меню, профиль, рекламу приложения и логотипную область футера.
- Не включать парковку и строку «Дополнительно», которая в макете относится к парковке.
- Не включать «Самая низкая цена», «Лучшие места», «Хорошая видимость», «Далеко от сцены» и рекомендательные подборки.
- В блоке под схемой показывать только реально выбранные билеты; удаление строки снимает выбор на схеме. Никаких фиктивных строк из Figma.
- Вместо серой заглушки «Схема зала» встроить нашу схему с выбором, pan/pinch, этажами/секторами и GA-зонами.
- Сохранить одинаковую функциональность desktop/mobile. Изменение раскладки не сбрасывает состояние.
- Сейчас подготовить только этот план. UI, контракты и SDK реализуются следующими задачами.

Решения для первой реализации, которые можно менять без переписывания UI:

1. Удерживать выбранные места при «Продолжить» на первом шаге. До ответа сервера выбор предварительный, таймер и обещание резерва не показываются. Это уточнение поведения макета, где таймер нарисован уже над выбором.
2. На шаге контактов запросить email-подтверждение только если сервер требует его для этой сессии. Уже подтверждённому пользователю не навязывать OTP. Регистрация/личный кабинет остаются у host-продукта.
3. Реальную оплату открывает платёжный адаптер: браузерный redirect или native host. Сам виджет не принимает реквизиты карты. Провайдер и callback URL согласуются с backend/native-командой перед HTTP-приёмкой.
4. Валюта приходит с сервера. AMD из макета — пример, не константа. Начальная локаль ru-RU; строки вынести в словарь, поддержать передаваемую локаль.
5. Сервисный сбор, комиссия и скидка показываются только по серверной разбивке. Несогласованные суммы из макетов не копировать.
6. Кнопки «Назад к мероприятию», «Подробнее», «История заказов», «Открыть билет» используют host-actions. Отсутствующее действие не должно вести на выдуманный URL.
7. Для сборки полноценного mock-flow эти решения достаточны. Производственные решения об авторизации, платежах, OTP, тарифах и native-мосте фиксируются в интеграционном контракте до подключения сервера.

## 2. Что уже существует и что нужно переиспользовать

| Код | Состояние и действие |
| --- | --- |
| `apps/embed/src/pages/embed/ui/EmbedPage.tsx` | Отдельный пример с fixture и сообщением вместо checkout; заменить оболочкой общего виджета |
| `libs/seat-view/src/lib/SeatView.tsx` | Выбор, доступность, цены, карта, список и корзина связаны в одном компоненте; выделить публичную композицию без дублирования логики |
| `libs/seat-view/src/lib/useSeatSelection.ts` | Переиспользовать проверки и операции выбора; не создавать вторую независимую корзину |
| `libs/seat-view/src/lib/availabilityDeltas.ts` | Уже умеет применять последовательность ревизий и запрашивать resync; добавить API-контекст occurrence/layout вокруг существующего алгоритма |
| `libs/seat-view/src/lib/seatViewEmbed.tsx` | Есть DOM mount/update/dispose для выбора мест; сохранить совместимость. Это пока не полный процесс покупки и не native-мост |
| `libs/hall-viewer`, `libs/renderer-core`, `libs/renderer-konva`, `libs/renderer-webgl` | Существующие движки и камера; использовать без новой реализации холста |
| `libs/domain/src/lib/model/layoutProjection.ts` | Удаляет фоны и assets редактора из покупательской проекции. Сохранить эту границу на API |
| `libs/api-contracts/src/contracts.ts`, `pricing.ts`, `openapi.ts`, `openapi.json` | Предлагаемый v1: hall/layout, occurrence, цены, availability, hold, order, checkout; недостаточно для контактов/OTP/промокода/платёжного перехода |
| `libs/api-axios/src/client.ts`, `mapping.ts` | Повторно использовать ошибки, отмену запросов, проверку схем и преобразование minor units в формат существующего SeatView |
| `apps/studio/src/pages/api/ApiStudioPage.tsx` | Есть hold → order → checkout и обработка изменившейся суммы; извлечь идеи и операции, не импортировать страницу Studio в библиотеку |
| `libs/ui/src/lib/primitives.tsx` | Button, Field, Select, Dialog, Drawer; расширять конфигурацию/стили при необходимости |
| `libs/design-tokens/styles.css` | Текущая тема Inter/teal отличается от макета; новая тема scoped на widget root |

Контракты API в репозитории являются предложением для backend, а не подтверждением серверной реализации. В проекте не найден backend-сервис. Существующие цены и удержания в Studio demo не становятся реальными продажами при переносе UI.

## 3. Визуальная спецификация

- Desktop-референс 1440 px: внутренний контент 1200 px, боковая колонка около 316 px, промежуток 20 px, основная колонка 864 px. При исключении header/footer убрать их высоты и пустые отступы, сохранив внутреннюю композицию.
- Desktop: слева вертикальные четыре шага и карточка мероприятия; справа текущий шаг. Карточка содержит постер, название, дату, место проведения и host-action подробностей.
- Mobile-референс 360 px: одна колонка, поля 20–24 px; заголовок/навигация, сеанс, резерв, компактная карточка события на выборе, схема, выбранные билеты и итог. На контактах имя/фамилия рядом, телефон/email на всю ширину.
- Breakpoint определить шириной контейнера, а не устройством: начальная граница 960 px, затем проверить промежуточные размеры. Widget в узкой колонке desktop должен вести себя как mobile.
- Использовать Manrope, текст `#323544`, акцент `#BC2D9B`, светлый акцент `#FFEBF5`, поверхности `#FFFFFF`/`#F5F5F5`, состояния предупреждения `#FFF7E6`/`#EEA918` и ошибки `#FFF3F3`/`#F36E6E`. Точные радиусы, поля, иконки и типографику снять с дочерних узлов перед версткой.
- Экспортировать тему как CSS variables под `.ticket-purchase`; не менять `:root` принимающего сайта. Существующие UI/Canvas-токены адаптировать внутри того же root.
- Легенда «Доступно / Выбрано / Занято» соответствует фактическим стилям renderer. Статусы held/sold/blocked/unavailable остаются различимы текстом и доступными подписями.
- Высоту карты сделать ограниченной и адаптивной, без жёсткого переноса полной высоты Figma-страницы. ResizeObserver обновляет canvas после изменения контейнера, клавиатуры и ориентации.
- WebView: safe-area inset, динамическая высота viewport, клавиатура не перекрывает поле/CTA; touch-action ограничивать картой. Вертикальный scroll страницы не должен ломаться после pan/pinch.
- Кнопки макета визуально компактные; эффективная touch-зона не меньше 44×44 px. Ошибки полей связать с label/aria-describedby; активный шаг имеет aria-current; диалоги удерживают и возвращают фокус.
- Постер — входные данные события; иконки и необходимые статические ресурсы скачать при реализации из Figma. Не использовать временные URL и снимки экранов в UI. Шрифт подключить локально/через host после проверки доступного файла и лицензии.

## 4. Публичная архитектура и файлы

Создать библиотеку `libs/ticket-purchase` (Nx project `ticket-purchase`, пакет `@hall-platform/ticket-purchase`). React/react-dom — peer dependencies как у seat-view; библиотека не зависит от Studio, fixtures и native SDK.

| Файл/область | Ответственность |
| --- | --- |
| `libs/ticket-purchase/src/index.ts` | Явный публичный API компонентов, provider, hooks и типов |
| `src/lib/TicketPurchaseWidget.tsx` | Готовая композиция всех шагов из тех же публичных компонентов |
| `src/lib/TicketPurchaseProvider.tsx` | Создание/подключение одного контроллера на экземпляр виджета |
| `src/lib/model/purchase.types.ts` | DTO UI, шаги, состояния, host-actions и provider interface |
| `src/lib/model/createPurchaseController.ts` | Состояния и переходы, независимые от конкретной разметки |
| `src/lib/model/purchaseEffects.ts` | Отмена/сериализация запросов, idempotency keys, защита от устаревших ответов |
| `src/lib/model/useTicketPurchase.ts` | React-подписки и действия для самостоятельной сборки |
| `src/lib/model/holdClock.ts` | Время сервера, expiry, события смены состояния; не рендерить карту каждую секунду |
| `src/lib/ui/PurchaseLayout.tsx`, `PurchaseStepper.tsx`, `EventSummary.tsx`, `OccurrenceSelector.tsx` | Адаптивная структура и контекст события |
| `src/lib/ui/TicketSelectionStep.tsx`, `SelectedTicketsList.tsx`, `SelectedTicketRow.tsx` | Карта и список выбранных мест/GA |
| `src/lib/ui/ContactDetailsForm.tsx`, `EmailVerificationDialog.tsx` | Контакты и условный OTP |
| `src/lib/ui/HoldTimer.tsx`, `HoldNotice.tsx`, `HoldExpiredDialog.tsx` | Отдельные подписки на резерв |
| `src/lib/ui/PaymentStep.tsx`, `PromoCodeField.tsx`, `OrderSummary.tsx`, `PurchaseSuccess.tsx` | Промокод, суммы, запуск оплаты и серверный результат |
| `src/lib/adapters/httpPurchaseDataSource.ts` | Обёртка typed API-клиента; отдельный package export `/http` |
| `src/lib/embed/createTicketPurchaseEmbed.tsx` | Необязательный DOM mount/update/dispose полного flow; export `/embed` |
| `src/lib/i18n/messages.ts`, `styles.css`, `theme.css` | Тексты и изолированное оформление |
| `libs/seat-view/src/lib/SeatMap.tsx`, `SeatSelectionProvider.tsx` | Выделенный существующий canvas/контроллер выбора, пригодный для композиции |
| `libs/seat-view/src/index.ts`, `SeatView.tsx` | Экспорт новых частей; прежний SeatView собирается из них с совместимыми props |
| `apps/embed/src/app/App.tsx`, `src/pages/embed/ui/EmbedPage.tsx` | Маршрут, bootstrap и монтирование готового widget |
| `apps/embed/src/shared/bridge/{protocol.ts,webViewBridge.ts}` | Версионированный протокол, handshake, native-адаптер |
| `apps/embed/src/shared/demo/mockPurchaseDataSource.ts` | Mock-fixtures и сценарии; включать только явным demo/dev режимом |
| `apps/embed/src/pages/composed/ui/ComposedPurchasePage.tsx` | Пример той же страницы, собранной из публичных частей |

Пути `src/lib/...` в таблице относятся к `libs/ticket-purchase`, если другая библиотека не указана. Для новой библиотеки добавить `package.json`, `project.json`, tsconfig-файлы, ESLint/Vitest config по существующим workspace-библиотекам; обновить references и lockfile. Не придумывать новую систему сборки.

Публичный интерфейс должен поддерживать оба сценария:

```tsx
<TicketPurchaseWidget occurrenceId={id} dataSource={source}
  locale="ru-RU" hostActions={hostActions} />

<TicketPurchaseProvider occurrenceId={id} dataSource={source} hostActions={hostActions}>
  <PurchaseLayout sidebar={<><PurchaseStepper /><EventSummary /></>}>
    <TicketSelectionStep />
  </PurchaseLayout>
</TicketPurchaseProvider>
```

Во втором примере host выбирает текущий шаг через `useTicketPurchase`; пример в репозитории обязан включать все шаги и давать тот же результат, что готовый widget. UI-компоненты используют общий provider; низкоуровневые строки/summary также принимают явные props для повторного использования. Два экземпляра на странице независимы, глобального singleton-store нет. Импорт пакета безопасен без window; браузерные операции запускаются после mount.

### 4.1 Контроллер и бизнес-переходы

Основные шаги: `selection → contacts → payment → success`. Операционные состояния: loading, reserving, verifying, quoting, paymentPending, expired, recoverableError. Шаг не меняется от одного клика, если соответствующая серверная операция не завершилась.

- Смена occurrence отменяет запросы старого контекста; при действующем hold спросить о сбросе выбора, затем отменить hold и загрузить новое событие. Не переносить seatId между событиями.
- Выбор места → предварительная корзина. Продолжить → createHold с availability/layout/pricing revisions → показать серверную сумму и expiry → contacts.
- Возврат к карте с действующим hold сохраняет зарезервированный набор. При редактировании сначала явно освободить hold; при неизвестном результате отмены выполнить GET/resync, затем разрешить новый выбор. Не держать два противоречивых hold.
- Контакты валидируются локально и сервером. После записи: либо проверка email, либо payment по server capability. Изменение подтверждённого email сбрасывает его verification.
- Создать/восстановить order по hold; получить quote. Изменение промокода получает новый quote; оплатить можно только показанный и подтверждённый quoteId/revision.
- При изменении цены/комиссии явно показать новую сумму и потребовать повторное подтверждение. Клиент никогда не отправляет доверенный total.
- Таймер считается из expiresAt и serverTime с monotonic clock; после background/resume перечитать сервер. UI-время 00:00 блокирует новую оплату и запрашивает состояние.
- После expiry вернуть к повторному резервированию с сохранением контактов в памяти; места повторно проверить. Сообщение Figma не является разрешением продавать без действующего резерва.
- Если платёж уже начат, исход определяет серверный order/payment status. Не считать оплату отменённой только по локальному таймеру и не освобождать автоматически inventory в paymentPending.
- В paymentPending заблокировать редактирование selection, смену occurrence и возврат к изменяемому checkout. Back/close может закрыть оболочку, но не освобождает payment inventory; перед повторной покупкой выполнить server reconciliation. Отмена оплаты допустима только по отдельной подтверждённой сервером операции.
- Redirect/native callback означает «проверить статус», а не «успех». Success показывается только после подтверждения backend; повторный callback не создаёт второй заказ.
- Сетевой timeout после mutation: тот же idempotency key и тот же payload, затем восстановление состояния. При смене payload — новая логическая операция/ключ.

## Chunk 1: контракты и интеграционные границы

### Задача 1. Описать buyer DTO отдельно от существующего v1

**Создать:** `libs/api-contracts/src/buyer.ts`, `buyer.spec.ts`.

**Изменить:** `libs/api-contracts/src/index.ts`, `openapi.ts`, `openapi.json`, `openapi.spec.ts`.

- [ ] Ввести namespace `/api/v2/buyer` и схемы `apiVersion: 'v2'`; v1 admin/Studio сохранить. Текущие strict Zod-схемы не расширять несовместимыми полями молча.
- [ ] Описать BuyerOccurrenceSummary: occurrenceId, eventId, title, startsAt, timeZone, venue `{name, city, address?}`, poster `{url, alt}?`, salesStatus, currency, capabilities. Список сеансов содержит summaries и pagination, без полных схем всех залов.
- [ ] Описать BuyerContext: summary, layoutVersionId, availabilityRevision, pricingRevision, serverTime, ownHold, capabilities `{promoCode, emailVerification, paymentMode}`. Конкретный режим оплаты приходит с сервера.
- [ ] Описать контакты `{firstName,lastName,phone,email}` с field-errors; phone не ограничивать примером +7, нормализация по согласованному международному формату. Contact revision и verifiedEmail принадлежат buyer-session.
- [ ] Описать Hold: id, owner session, occurrenceId, layoutVersionId, revision, expiresAt, serverTime, selection, authoritative line items/total и availabilityRevision. Состояния active/expired/cancelled/converted различаются.
- [ ] Описать Quote: quoteId, orderId, revision, expiresAt, currency, lines, ticketsSubtotalMinor, discountMinor, serviceFeeMinor, commissionMinor, totalMinor, promo status. Инвариант total = subtotal - discount + serviceFee + commission, безопасные целые числа; денежные расчёты в minor units.
- [ ] Описать Order: id, revision, immutable selection/labels/prices snapshot, contacts reference, holdId, quoteId, status pending/payment_pending/confirmed/cancelled/expired/failed, paymentStatus, createdAt, ticket delivery status. Revision растёт при принятии нового quote и изменении checkout/payment/order state; read не меняет revision. 409 возвращает currentRevision; клиент перечитывает order и quote, затем явно повторяет новую операцию с актуальными данными.
- [ ] Описать SessionResume: purchaseSessionId, occurrenceId, contact + contactRevision + emailVerification, ownHold (включая converted), activeOrder, activePaymentAttempt и serverTime. Отсутствующие сущности nullable. Возвращать текущий order даже после превращения hold в order, чтобы reload не создавал новый заказ.
- [ ] Описать PaymentAttempt: id, orderId, status, action `{kind:'redirect',url}` или `{kind:'native',payload}` либо `{kind:'none'}`; сервер возвращает допустимое действие, не исполняемый JS.
- [ ] Описать TicketSummary: ticketId, orderId, occurrenceId, display labels, deliveryStatus; download/open URL отдавать только авторизованному владельцу, срок действия указывать явно. Билет может выпускаться асинхронно после оплаты.
- [ ] Описать OTP challengeId, destinationMasked, codeLength, expiresAt, resendAvailableAt, attemptsRemaining; code никогда не возвращать production-клиенту.
- [ ] Уточнить public layout: backgrounds пустые, assets отсутствуют; не отправлять PDF, изображения-подложки, локальные blobs. Текущая v1-проверка запрещает только PDF — это слабее нового требования и должно быть отражено в v2 schema/tests.
- [ ] Добавить ошибки session_expired, sales_closed, price_changed, quote_expired, invalid_promo, verification_required, invalid_code, code_expired, payment_failed, layout_version_conflict. Ошибка несёт field path/retryAfter/currentRevision где применимо.

**Приёмка:** positive/negative примеры для seat и GA, чужого occurrence/layout, некорректной суммы, приватных backgrounds, контактов и OTP; v1 продолжает парсить прежние fixture. OpenAPI JSON соответствует runtime-схемам.

### Задача 2. Зафиксировать HTTP-операции и данные для backend

Все пути ниже — предложение для согласования, не утверждение о существующем сервере. Префикс `/api/v2/buyer`; authenticated buyer-session отделена от admin JWT. Сервер проверяет владельца каждого hold/order/challenge.

| Метод и путь | Запрос/ответ и семантика |
| --- | --- |
| `POST /sessions` | Создать guest session либо обменять одноразовый host bootstrap credential; вернуть scope/expiry и session credential безопасным согласованным способом |
| `GET /sessions/current/resume` | SessionResume текущего purchase flow: контакты и verification, hold, order/payment references со статусами и revisions; проверка владельца |
| `GET /events/{eventId}/occurrences?cursor=...` | Лёгкие summaries сеансов для переключателей даты/времени |
| `GET /occurrences/{id}/context` | BuyerContext и собственный hold; без тяжёлой геометрии |
| `GET /occurrences/{id}/seat-map` | Полная публичная геометрия небольшого зала с layoutVersionId |
| `GET /occurrences/{id}/availability` | Snapshot с occurrenceId/layoutVersionId/revision/serverTime |
| `GET /occurrences/{id}/availability-changes?sinceRevision=...` | Последовательные дельты; при невозможности воспроизведения явный resyncRequired |
| `GET /occurrences/{id}/prices` | Серверные цены с occurrence/layout/pricing revisions и currency |
| `POST /occurrences/{id}/holds` | selection и ожидаемые revisions; атомарная проверка inventory и цены, idempotency |
| `GET /holds/{id}`, `DELETE /holds/{id}` | Восстановление/освобождение собственного hold; отмена идемпотентна |
| `PUT /sessions/current/contact` | Контакты, expected revision; ответ с validation и verification requirement |
| `POST /sessions/current/email-challenges` | Начать/повторить отправку, лимиты сервера и resendAvailableAt |
| `POST /email-challenges/{id}/verify` | code; подтверждение именно текущего email текущей сессии |
| `POST /orders` | holdId + contactRevision; один order на hold, повтор операции возвращает тот же order |
| `POST /orders/{id}/quotes` | promoCode или null, expected order revision; сервер рассчитывает полную сумму |
| `POST /orders/{id}/checkout` | quoteId + quoteRevision; проверить hold/контакты/verification, создать/reuse payment attempt |
| `GET /orders/{id}` | Источник истины о платеже, заказе и ticket delivery; polling после возврата/timeout |
| `GET /orders/{id}/tickets` | Доступные владельцу билеты; pending delivery — отдельное состояние |

- [ ] Для mutations описать Idempotency-Key, revision/If-Match там, где изменяется существующая сущность; повтор с другим телом отклонять 409.
- [ ] Формализовать 400/401/403/404/409/410/422/429/503, retry-after, AbortSignal на клиенте. Сетевой abort не означает отмену серверной транзакции.
- [ ] Разделить авторизацию покупателя и идентификатор процесса purchaseSessionId. Каждый widget получает отдельную purchase session; запросы `/sessions/current/*` явно адресуют её заголовком `X-Purchase-Session-Id`, проверяемым сервером. Несекретный id допускается сохранять в sessionStorage по instanceId и передавать через host bootstrap; bearer credentials там не сохранять.
- [ ] После reload браузер восстанавливает авторизацию через согласованную защищённую first-party HttpOnly cookie (с CSRF-защитой mutations) либо host credential provider; WebView повторяет handshake и получает credential от native host. После авторизации вызвать resume, затем GET order/hold при необходимости. При недоступной/истёкшей авторизации показать восстановление сессии, не создавать молча новый checkout. Cross-origin host использует credential provider; наличие third-party cookies не предполагать.
- [ ] Привести request/response/error examples для каждого нового operationId, включая уже истёкший резерв и успешный платёж с ещё готовящимися билетами.
- [ ] Backend хранит: immutable layout versions (включая occurrence-specific версии), связь occurrence→version, price assignments/revisions, inventory/capacity, session/contact verification, holds/expiry, order line snapshots, quote breakdown, payment attempts, tickets и idempotency results.
- [ ] Черновики редактора и их PDF/assets принадлежат admin storage. Публичная проекция строится сервером; фильтрация только на клиенте недостаточна.
- [ ] Зафиксировать транзакционные правила: один seat не продаётся двум заказам; GA capacity не уходит ниже нуля; expired hold не подтверждается; callback провайдера идемпотентен; повтор checkout не создаёт вторую оплату.
- [ ] Зафиксировать lease inventory на время внешнего платежа и поведение позднего webhook после expiry; это серверное решение перед production-приёмкой.
- [ ] Согласовать с backend/auth/native-командой guest mode, срок сессии, механизм token refresh, разрешённые redirect/deep-link адреса, OTP-сервис, комиссию/скидки, провайдера оплаты и выпуск билетов. До согласования mock-flow реализуем, реальную продажу завершённой не объявляем.

**Приёмка:** самодостаточный OpenAPI 3.1 с DTO, примерами и серверными правилами, пригодный для передачи backend. Проектирование физических таблиц/индексов остаётся у backend; OpenAPI не называть готовой схемой БД.

### Задача 3. Общий интерфейс источника данных и mock

**Создать:** `libs/ticket-purchase/src/lib/model/purchase.types.ts`, `adapters/httpPurchaseDataSource.ts`, `apps/embed/src/shared/demo/mockPurchaseDataSource.ts`, тесты рядом.

**Изменить:** `libs/api-axios/src/client.ts`, `mapping.ts`, `index.ts`; новый `buyerClient.ts` и `buyerClient.spec.ts` для v2.

- [ ] Интерфейс PurchaseDataSource: createSession, resumeSession, getContext, listOccurrences, getSeatMap, getAvailability, getPrices, getChanges, create/get/cancelHold, saveContact, request/verifyEmail, create/getOrder, createQuote, checkout, getTickets. Все IO принимают AbortSignal; mutations — отдельный idempotency key; session-scoped операции несут purchaseSessionId.
- [ ] Добавить typed v2 client с Zod-валидацией на входе/выходе и совместимым преобразованием цен для SeatView только на границе renderer.
- [ ] Mock реализует те же DTO/методы и переходы, включая ошибку/задержку, истечение, OTP, промокод, изменившуюся цену и pending payment. Clock и latency инъецируются для воспроизводимости.
- [ ] Mock-scenario выбор доступен только явно в dev/demo; production без настроенного source показывает конфигурационную ошибку, а не выдуманную успешную покупку.
- [ ] Contract tests запускаются для mock и HTTP test server на одинаковых сценариях. Не импортировать mock/fixtures в production export новой библиотеки.

## Chunk 2: переиспользуемый UI и процесс покупки

### Задача 4. Выделить карту и выбор из SeatView

**Файлы:** `libs/seat-view/src/lib/{SeatView.tsx,SeatMap.tsx,SeatSelectionProvider.tsx,useSeatSelection.ts}`, `src/index.ts`, тесты рядом.

- [ ] Сначала закрепить текущие сценарии SeatView: выбор seat/GA, deselect, controlled selection, отказ при недоступности, resync и renderer fallback.
- [ ] Выделить карту и общую выборку состояния в самостоятельные части, сохранить индексы/камеру/LOD и callbacks.
- [ ] Собрать старый SeatView из выделенных частей с прежним внешним контрактом. Новый TicketSelectionStep использует карту без старой встроенной корзины/лишних toolbar.
- [ ] Обеспечить собственный hold как выбираемые пользователем места, не считая любой чужой held доступным. Источник ownership — серверный ownHold, не догадка по seat status.
- [ ] Новый список выбранных билетов и canvas читают одну selection; удаление, GA quantity и conflict отражаются одновременно.

**Приёмка:** существующие Studio/API Studio/embed consumers не сломаны; новый layout не создаёт второй canvas и отдельный набор правил выбора.

### Задача 5. Создать библиотеку, тему и базовую композицию

**Файлы:** конфигурации `libs/ticket-purchase`, `TicketPurchaseProvider.tsx`, `TicketPurchaseWidget.tsx`, `ui/PurchaseLayout.tsx`, `ui/PurchaseStepper.tsx`, `ui/EventSummary.tsx`, `theme.css`, `styles.css`, `i18n/messages.ts`.

- [ ] Зарегистрировать Nx-библиотеку и ESM/types/CSS exports; HTTP и DOM adapters вынести в subpath exports, React оставить peer dependency.
- [ ] Создать provider/controller per instance; public hooks не зависят от App/router.
- [ ] Реализовать scoped Figma theme и UI primitives на существующих Button/Field/Dialog.
- [ ] Собрать desktop/mobile shell по ширине контейнера; шаги, карточка, навигация и loading/error состояния.
- [ ] Обеспечить hostActions для возврата/подробностей/истории/билетов; не захватывать навигацию сайта глобально.
- [ ] Добавить consumer example, который собирается только через exports пакета; проверить два виджета и host CSS без пересечения состояния/стилей.

**Приёмка:** ни header/footer, ни парковки, ни рекомендательных секций; новый widget не меняет тему Studio и окружающего сайта.

### Задача 6. Выбор билетов и получение резерва

**Файлы:** `ui/{TicketSelectionStep,OccurrenceSelector,SelectedTicketsList,SelectedTicketRow,OrderSummary}.tsx`, `model/{createPurchaseController,purchaseEffects}.ts`, тесты рядом.

- [ ] Загрузить context, geometry, availability и prices с контролем идентификаторов/ревизий; показать отдельные состояния initial loading, not found, sales closed, sold out, network error/retry.
- [ ] Сгруппировать сеансы по локальной дате в timeZone события, выбрать occurrence по его id; дата не должна вычисляться по timezone компьютера случайно.
- [ ] Встроить SeatMap, доступную альтернативу выбора и список только выбранных мест; для GA показывать сектор, количество и цену без выдуманного ряда/места.
- [ ] Empty selection отключает продолжение; maxPerOrder и некорректная/смешанная валюта блокируют submit с объяснением.
- [ ] Создать hold по Continue; повторный клик не создаёт вторую операцию. Конфликт перечитывает inventory и выделяет недоступные позиции.
- [ ] После hold перейти к контактам; при другой сумме сервера показать изменения перед подтверждением.

**Приёмка:** seat/GA, удаление строки, смена сеанса, две конкурирующие сессии и stale response от старого occurrence имеют определённый результат.

### Задача 7. Контакты и email verification

**Файлы:** `ui/{ContactDetailsForm,EmailVerificationDialog}.tsx`, `model/contactValidation.ts`, controller/effects и тесты.

- [ ] Разметить четыре поля как в Figma, добавить autocomplete/inputMode, понятные field-errors и фокус первого ошибочного поля.
- [ ] Подставлять контакты из session/host prefill без объявления их подтверждёнными; изменение email сбрасывает verification.
- [ ] Сохранить контакты, выполнить условный OTP; поддержать paste/autofill полного кода, длину из challenge, cooldown повторной отправки.
- [ ] Обработать неправильный/истёкший код, лимит попыток, сетевой сбой, изменение email во время запроса и истечение hold в диалоге.
- [ ] Не сохранять контакты/OTP в query string, localStorage и аналитические события. Reload восстанавливает разрешённые данные через серверную сессию.

**Приёмка:** verified session проходит без лишнего OTP; непроверенный email не может обойти серверное requirement через прямой переход к payment.

### Задача 8. Quote, промокод и оплата

**Файлы:** `ui/{PaymentStep,PromoCodeField,OrderSummary}.tsx`, controller/effects, `model/money.ts`, тесты.

- [ ] Создать или восстановить order из hold и показать серверные line items.
- [ ] Реализовать promo idle/editing/applying/applied/invalid; удалить промокод новым quote с null. Устаревший ответ предыдущего кода не заменяет актуальную сумму.
- [ ] Показывать стоимость билетов, скидку, сервисный сбор, комиссию и итог; нулевые необязательные строки скрывать согласованно. Парковочных сборов нет.
- [ ] Проверять quote expiry/revision перед checkout; обновлённая сумма требует явного согласия.
- [ ] Запускать payment action через host adapter; блокировать повторное создание payment attempt, восстанавливать pending order после reload/return.
- [ ] Показывать pending/failed/cancelled с допустимыми повторными действиями, не считать закрытие платёжного окна подтверждением/окончательным отказом.

**Приёмка:** серверный итог согласован с разбивкой; двойной клик, timeout и redirect retry не создают дубли заказа/оплаты.

### Задача 9. Таймер, expiry и завершение

**Файлы:** `model/holdClock.ts`, `ui/{HoldTimer,HoldNotice,HoldExpiredDialog,PurchaseSuccess}.tsx`, тесты рядом.

- [ ] Отделить секундный timer-store от состояния карты; цвета warning/critical привязать к явно конфигурируемым порогам, не к номеру шага.
- [ ] При expiry показать диалог/баннер, заблокировать новую оплату, запросить authoritative state; повторный резерв проверить заново.
- [ ] При resume, online и payment callback перечитать order/hold; данные со старой revision не откатывают состояние.
- [ ] Success показывать по confirmed order. Если билеты ещё выпускаются, показать подтверждённую оплату и ожидание билетов; action «Открыть билет» доступен после выдачи.
- [ ] История заказов/билет передаются hostActions; для нескольких билетов передать весь список ids, не открыть произвольный первый молча.

**Приёмка:** expiry в background, завершение платежа одновременно с таймером, повторный callback, доставка билетов с задержкой воспроизводимы в mock и HTTP-contract tests.

## Chunk 3: WebView, доставка схемы и приёмка

### Задача 10. Оболочка embed и контракт с native host

**Файлы:** `apps/embed/src/app/App.tsx`, `src/pages/embed/ui/EmbedPage.tsx`, `src/shared/bridge/{protocol.ts,webViewBridge.ts}`, `src/main.tsx`, `index.html`, `src/styles.css`, тесты рядом.

- [ ] Ввести маршрут `/buy/:occurrenceId`, поддержать прямое открытие и reload через SPA fallback hosting. В query разрешить только безопасные display-параметры, например locale; credentials туда не помещать.
- [ ] Bootstrap включает occurrenceId, locale, theme, host capabilities и способ получить session credential. Если native host ещё не готов, показать загрузку handshake и таймаут с retry.
- [ ] Envelope моста: `{version:1, instanceId, requestId, type, payload}`. Валидировать сообщения Zod-схемой, поддержать ready/init/ack/error, timeout, ignore duplicate requestId и неподдерживаемую версию.
- [ ] Host→widget: init, back, resume, authUpdated, paymentReturned. Widget→host: ready, stateChanged (step/canGoBack), closeRequested, eventDetailsRequested, paymentRequested, orderConfirmed, ticketsRequested, historyRequested, error.
- [ ] back сначала закрывает диалог, затем возвращает шаг; на первом шаге вызывает closeRequested. Native back не должен одновременно менять browser history и шаг.
- [ ] Для browser iframe проверять origin/source и использовать конкретный targetOrigin; native adapter привязать к разрешённому origin WebView и документированному каналу. Название Flutter/Android/iOS bridge согласовать, не импортировать SDK в React-библиотеку.
- [ ] WebView navigation/payment URL пропускать через allowlist, смену auth/session отменять вместе с запросами. Bridge не принимает команд «назначить success» и не исполняет полученный код.
- [ ] Отправлять агрегированную ошибку/статус без контактов, tokens и OTP. Заказ перечитывать с сервера после paymentReturned.
- [ ] Учесть safe area, экранную клавиатуру, поворот, background/resume, закрытие WebView. Dispose снимает listeners, timers и observers; закрытие не гарантирует DELETE hold, expiry на сервере обязателен.

**Приёмка:** mock host + browser smoke; на реальном Android WebView и iOS WKWebView отдельно проверить жесты, keyboard, back, resume и внешний платёжный возврат. Browser mobile emulation не выдавать за проверку native.

### Задача 11. React composition и поставка SDK

**Файлы:** `libs/ticket-purchase/src/index.ts`, `package.json`, `src/lib/embed/createTicketPurchaseEmbed.tsx`, `apps/embed/src/pages/composed/ui/ComposedPurchasePage.tsx`, `README.md`.

- [ ] Сделать полный пример ручной композиции всех шагов через public exports/provider/hooks и готовый widget рядом в тестовом host.
- [ ] Добавить mount/update/dispose для non-React host; не менять существующий createSeatViewEmbed без миграции.
- [ ] Настройки: occurrenceId, locale, root theme tokens, source, hostActions; переключение props отменяет старый контекст и не переносит чужой hold.
- [ ] Проверить ESM/types/CSS exports и peerDependencies, отсутствие дублированного React, импорт без DOM, отсутствие Studio/editor/PDF/fixtures в startup production-графе.
- [ ] Документировать запуск WebView URL, готовый widget, ручную композицию, source replacement, bridge protocol, mock mode, ответственность backend/host за оплату и навигацию.

**Приёмка:** внешнее React-приложение может собрать весь flow без deep-import внутренних файлов; готовый и составной варианты используют один controller и проходят одинаковый сценарий.

### Задача 12. Схема 50 000 мест и обновления доступности

**Файлы:** `libs/api-contracts/src/buyerGeometry.ts`, `libs/api-axios/src/buyerGeometryClient.ts`, `libs/seat-view/src/lib/{geometryLoader,geometryCache}.ts`, `libs/ticket-purchase/src/lib/model/availabilitySync.ts`, тесты рядом; существующие renderer-core/hall-viewer — только нужные адаптеры.

- [ ] Согласовать public immutable manifest: layoutVersionId, schemaVersion, bounds, floors/sectors, blocks `{id,bounds,url,byteLength,hash}` и overview. Доступность/цены не помещать в immutable геометрию.
- [ ] Добавить `GET /occurrences/{id}/geometry-manifest` и выдачу блоков по версионированным URL; полный seat-map оставить совместимым для небольших залов. Каждому seatId определить одного владельца блока.
- [ ] Интегрировать частичную сцену с renderer: сначала обзор, детали viewport/сектора, отмена запросов, лимит concurrency, ограниченный byte-LRU и prefetch соседей. Не собирать все блоки перед первым кадром.
- [ ] Корзина хранит labels/ids из selection/hold отдельно от загруженных блоков; eviction не удаляет выбранные билеты. Доступный поиск/list не требует загрузить 50k мест сразу.
- [ ] Для availability использовать один канал: сначала revision polling дельт с backoff; SSE/WebSocket — отдельная последующая замена адаптера при согласовании, без параллельных независимых каналов.
- [ ] Перед applySeatAvailabilityDeltas проверить occurrenceId и layoutVersionId; gap/out-of-order/overflow вызывает snapshot resync. Prices имеют собственную revision; изменившаяся цена обновляет quote и требует подтверждения.
- [ ] Не включать WebGL по умолчанию на основании mock-прогона: использовать существующую политику fallback, подтвердить GPU/телефоны отдельно.

**Приёмка:** overview до полной геометрии, выбор/камеру не сбрасывают status updates; 50k не обрабатываются заново каждую секунду таймера. Это этап готовности большого зала, его нельзя объявить выполненным только по верстке малого demo.

### Задача 13. Проверки, backend handoff и документация

**Файлы:** новые тесты компонентов/controller/API рядом с исходниками; `apps/embed/e2e/{purchase-flow,composition,webview-bridge,buyer-performance}.spec.ts`, `apps/embed/playwright.config.mts`, `README.md`, `libs/api-contracts/openapi.json`.

- [ ] Сначала адресные unit/contract проверки инвариантов: revisions, ownership, деньги, конкурентный hold, quote change, idempotency, OTP, race/abort и expiry.
- [ ] Браузерный flow: выбор нескольких мест/GA → контакты → условный код → промокод → оплата → server-confirmed success → host action. Запустить и для готового widget, и для ручной композиции.
- [ ] Добавить негативные E2E: empty/sold out, чужой hold, конфликт, offline/retry, stale quote, неправильный код, expiry, pending payment, неизвестный результат mutation, reload/resume, неподдерживаемый bridge.
- [ ] Расширить Playwright config: desktop Chromium, mobile Chromium, mobile WebKit; конфигурация сейчас содержит только chromium. Добавить production-preview режим с реальной сборкой и фиксированными данными.
- [ ] Визуально сравнить контент без host header/footer при 360, 390, 768, 1024 и 1440 px; отдельно узкий widget в широком host, масштаб текста 200%, длинные названия/цены. Учесть намеренные удаления из макета.
- [ ] Проверить клавиатуру и screen-reader labels, focus restore диалогов, touch targets, safe area, шрифты/ассеты и scoping CSS.
- [ ] Замерить 5k/50k: холодный старт, pan/pinch, выбор, смена доступности, таймер, reconnect; зафиксировать сеть/устройство/GPU. Цели первого обзора p75 ≤2.5s, реакции выбора ≤100ms, INP p75 ≤200ms — цели, не текущие результаты.
- [ ] Передать backend обновлённый OpenAPI с examples, DTO и правилами хранения/транзакций из задач 1–2, перечень v1→v2 различий и незакрытых сервисных решений. Фактическая отправка команде — отдельное действие пользователя.
- [ ] В README указать реальные выполненные проверки и ограничения. Отдельно отметить mock-ready, HTTP-ready и проверку на физических WebView.

Команды после реализации (новые Nx projects должны называться как указано):

```powershell
pnpm nx run-many -t test --projects=api-contracts,api-axios,seat-view,ticket-purchase,embed --output-style=static
pnpm nx run-many -t typecheck --projects=api-contracts,api-axios,seat-view,ticket-purchase,embed,studio
pnpm nx run-many -t lint --projects=api-contracts,api-axios,seat-view,ticket-purchase,embed,studio --output-style=static
pnpm nx run-many -t build --projects=ticket-purchase,embed,studio
pnpm exec playwright test --config apps/embed/playwright.config.mts --project=chromium
pnpm exec playwright test --config apps/embed/playwright.config.mts --project=mobile-chromium --project=mobile-webkit
git diff --check
```

Первые команды запускают адресные проекты; mobile projects добавить в задаче 13 до использования команды. Проверку `openapi.json` выполнять существующим sync-тестом из `libs/api-contracts/src/openapi.spec.ts`; JSON получать из `openApiDocument`, не править вручную независимо от Zod.

## 5. Порядок выпуска и критерии завершения

1. **Контракты:** задачи 1–3. Получить согласуемую спецификацию и источники данных; UI может развиваться на mock до готовности сервера.
2. **Компоненты и mock-flow:** задачи 4–9, затем 11. Показать весь flow по Figma на desktop/mobile и две эквивалентные React-композиции.
3. **WebView:** задача 10 и native интеграционные проверки. Host-приложение реализует свою сторону протокола.
4. **HTTP и большие залы:** согласовать API с backend, подключить HTTP-source и задачу 12; пройти реальные конфликты inventory/платёжный возврат.
5. **Приёмка:** задача 13. Подтверждённая оплата и билет требуют server/payment/ticket-сервисов; mock-success не является доказательством реальной покупки.

- [ ] Готовый WebView URL и React widget используют один flow.
- [ ] Host может собрать точно тот же flow из публичных React-компонентов.
- [ ] Нет header/footer, парковки и рекомендательных/оценочных групп билетов.
- [ ] Наша схема интерактивна; список отражает текущий выбор и GA quantity.
- [ ] Все шаги, OTP, промокод, expiry, pending/error/success имеют рабочие переходы.
- [ ] Таймер означает подтверждённый сервером резерв; денежные суммы/покупку подтверждает сервер.
- [ ] API содержит недостающие данные макета, host/native контракт описан, mock и HTTP взаимозаменяемы.
- [ ] Покупательская геометрия не раскрывает editor backgrounds/assets и поддерживает occurrence-specific версии.
- [ ] 50k/mobile и реальные WebView проверены отдельно от desktop/mock.

## 6. Состояние работы над этим документом

На момент составления изучены Figma и текущий код; исходные изменения `fix/todo_29.10` закоммичены и объединены с main. Ветка `feat/buy-tickets-flow` должна содержать относительно main только этот план. Реализация пунктов плана, новые контракты, зависимости и код виджета в текущую поставку не входят.
