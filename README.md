# Hall Platform

Локальная демонстрация редактора схем залов и покупательского виджета.

## Запуск

Требуются Node.js 24 и pnpm 12.14.0.

```bash
pnpm install --frozen-lockfile
pnpm nx serve studio
```

Studio откроется на http://localhost:4200/. В разделе «Демо-мероприятия» можно выбрать билеты и пройти локальное оформление. Черновики залов и демо-заказы сохраняются в IndexedDB браузера. Внешний API для демо не нужен.

## Подложки и копии схем мероприятия

PDF-подложки и их настройки принадлежат локальному редактору. Черновик зала
сохраняет PDF как Blob в IndexedDB; при публикации создаётся покупательская
проекция без подложек и PDF-материалов. Кнопка «Экспорт JSON» создаёт локальный
резервный файл редактора и включает подложки. Этот файл не отправляется на
сервер и сам по себе не является покупательской схемой. Очистка данных браузера
удаляет локальные черновики и PDF.

В настройке цен можно открыть редактор схемы конкретного demo-occurrence.
Изменения сохраняются в копии этого мероприятия вместе с согласованными ценами
и доступностью; исходный зал и другие мероприятия остаются отдельными. PDF
occurrence хранится в IndexedDB в отдельном versioned-контексте и не попадает в
покупательскую схему или предпросмотр. Черновик цен и схемы восстанавливается из
локального IndexedDB, если страницу закрыли до сохранения. Эта демо-операция
полностью локальная и пока не интегрирована с backend.

## Проверка

```bash
pnpm nx run-many -t lint typecheck test build --projects=studio,embed
pnpm exec playwright install chromium
pnpm nx e2e studio
```

## Интеграция компонентов

Публичные импорты доступны из пакетов `@hall-platform/hall-editor` и
`@hall-platform/seat-view`; импортировать файлы из `src` не требуется. Сейчас
библиотеки остаются внутренними пакетами workspace (`private: true`), поэтому
их можно использовать в приложениях этого workspace, но публикация в npm не
настроена. Компоненты рассчитаны на React и React DOM `>=19 <20` и используют
один экземпляр React, предоставленный приложением host.

Для схемы покупателя host хранит актуальные `layout`, `availability`, `prices`
и `selection`. `onSelectionChange` сообщает следующее состояние; после проверки
и подтверждения host обновляет selection или `availability` через новые props.
`occurrenceId` задаёт контекст события, а `snapshot.id` — версию схемы. Когда
меняется событие или схема, host должен передать соответствующую доступность и
сбросить несовместимый selection. `onBuyClick` получает копию выбора и может
вернуть Promise; ошибки передаются через `onError`. Компоненты не читают
localStorage приложения Studio.

### React host

```tsx
import { useState } from 'react';
import { SeatView, type SeatSelectionItem } from '@hall-platform/seat-view';
import '@hall-platform/design-tokens/styles.css';
import '@hall-platform/seat-view/styles.css';

function Booking({ layout, availability, prices }) {
  const [selection, setSelection] = useState<SeatSelectionItem[]>([]);

  return (
    <SeatView
      layout={layout}
      occurrenceId="show-2026-10-28"
      availability={availability}
      availabilityRevision={12}
      prices={prices}
      selection={selection}
      locale="ru-RU"
      onSelectionChange={setSelection}
      onBuyClick={async (order) => bookingApi.reserve(order)}
      onError={(error) => reportError(error)}
    />
  );
}
```

Для host без React root пакет `@hall-platform/seat-view` предоставляет
`createSeatViewEmbed(element, options)`. Element должен быть выделен только под
этот embed. `update(options)` передаёт новые props после изменения сессии,
доступности, схемы, locale или темы. `dispose()` отключает наблюдение размера,
отменяет активный checkout через `AbortSignal` и удаляет React root; повторный
вызов безопасен. Host остаётся владельцем selection, ошибок и вызова checkout.
`onCheckout(order, signal)` получает signal, который отменяется при смене
`occurrenceId`/`snapshot.id` или при dispose; host передаёт signal своему
сетевому запросу. ResizeObserver сообщает размеры через
`onResize`; сам SeatView также подстраивает схему под доступный контейнер.
Это прямое DOM-встраивание, iframe и `postMessage` не используются.

```ts
import { createSeatViewEmbed } from '@hall-platform/seat-view';
import type { SeatViewEmbedOptions } from '@hall-platform/seat-view';
import '@hall-platform/design-tokens/styles.css';
import '@hall-platform/seat-view/styles.css';

let embed: ReturnType<typeof createSeatViewEmbed> | undefined;
let current: Omit<SeatViewEmbedOptions, 'onSelectionChange' | 'onCheckout'> = {
  layout,
  occurrenceId: 'show-2026-10-28',
  availability,
  availabilityRevision: 12,
  prices,
  selection: [],
  locale: 'ru-RU',
  theme: 'light',
};
function getOptions(): SeatViewEmbedOptions {
  return {
    ...current,
    onSelectionChange(selection) {
      current = { ...current, selection };
      embed?.update(getOptions());
    },
    onCheckout: (order, signal) => bookingApi.reserve(order, { signal }),
    onResize: ({ width, height }) => layoutHost(width, height),
  };
}

embed = createSeatViewEmbed(document.querySelector('#tickets')!, getOptions());

// When the host changes show, full snapshot, locale or theme:
current = { ...current, ...nextOptions };
embed?.update(getOptions());

// When the page or modal closes:
embed?.dispose();
```

`HallEditor` — контролируемый компонент. Host хранит `value`, применяет
`onChange(layout, meta)`, а `onSave` и `onPublish` могут выполнять
асинхронную работу и сообщать об ошибке через `onError`. Модель черновика
доступна из публичного пакета:

```tsx
import { useState } from 'react';
import {
  HallEditor,
  createEmptyDraft,
  type HallLayoutDraft,
} from '@hall-platform/hall-editor';
import '@hall-platform/design-tokens/styles.css';
import '@hall-platform/hall-editor/styles.css';

function EditorHost() {
  const [value, setValue] = useState<HallLayoutDraft>(() =>
    createEmptyDraft('Мой зал'),
  );
  return (
    <HallEditor
      value={value}
      onChange={(next) => setValue(next)}
      onSave={async (draft) => saveDraft(draft)}
      onPublish={async (draft, warningsAcknowledged) =>
        publishDraft(draft, { warningsAcknowledged })
      }
      onError={reportError}
    />
  );
}
```

Внешний пример host собран как отдельное приложение `apps/embed` и отображает
схему малого театра из fixture через публичный импорт `@hall-platform/seat-view`.
Запуск: `pnpm nx serve embed`; сборка: `pnpm nx build embed`. Демо checkout
только показывает переданную selection и не выполняет бронирование.

## Ценовые сегменты

`@hall-platform/pricing-editor` — контролируемый административный компонент.
Host загружает read-only каталог сегментов и документ назначений для конкретных
`occurrenceId` и `layoutVersionId`, хранит черновик и отправляет его на сервер.
Пакет не создаёт сегменты, не меняет схему и не считает серверную цену.

```tsx
import { useState } from 'react';
import type { PricingAssignmentDocument, PricingCatalog } from '@hall-platform/domain';
import { PricingEditor, type PublishedPricingLayout } from '@hall-platform/pricing-editor';
import '@hall-platform/design-tokens/styles.css';
import '@hall-platform/pricing-editor/styles.css';

type Props = {
  layout: PublishedPricingLayout;
  catalog: PricingCatalog;
  initialDocument: PricingAssignmentDocument;
  savePricing: (document: PricingAssignmentDocument) => Promise<PricingAssignmentDocument>;
};

function PricingHost({ layout, catalog, initialDocument, savePricing }: Props) {
  const [document, setDocument] = useState<PricingAssignmentDocument>(initialDocument);
  return (
    <PricingEditor
      layout={layout}
      catalog={catalog}
      value={document}
      onChange={(next) => setDocument(next)}
      onSave={async (next) => {
        // savePricing validates and retains body/key if the network outcome is unknown.
        const saved = await savePricing(next);
        // Replace the draft with the server response, including its new revision.
        setDocument(saved);
      }}
    />
  );
}
```

Назначение seated-зоне полностью заменяет сегменты всех мест, найденных по
связям и точной геометрии; после этого отдельные места можно переназначить.
Последняя явная команда для пересекающихся зон определяет общий сегмент.
GA-зона получает одну цену за билет и сохраняет capacity из схемы. Если в GA
найдены места, назначение блокируется. Для непривязанных объектов цена
отсутствует: они не считаются бесплатными.

Для чернового отображения `createPricingPreviewPriceMap` преобразует только
проверенные назначения в карту `SeatView`; передайте её с `purchaseDisabled`,
чтобы отключить удержания и заказы. При реальной продаже отображайте цены из
ответа API, а итог и доступность подтверждайте через серверный hold.

API-режим Studio использует административные маршруты
`GET /api/v1/occurrences/{id}/pricing-segments`,
`GET /api/v1/occurrences/{id}/pricing-assignments` и атомарный
`PUT /api/v1/occurrences/{id}/pricing-assignments`. В PUT передаются только
контекст, segment IDs и метаданные версии; revision защищает от конкурентной
записи, а `Idempotency-Key` должен сохраняться при повторе того же запроса.
OpenAPI и клиентский контракт находятся в `libs/api-contracts` и
`libs/api-axios`. Backend в этом репозитории не реализован, поэтому перед
production-подключением требуется сверить статусы, auth, revisions, фактические
цены и сохранность котировок holds/orders с серверной командой.

Flutter-приложения и React WebView используют тот же backend occurrence,
availability, цены и hold/order API. Они не используют этот React pricing editor
и не должны принимать локальный preview за подтверждённую цену.
