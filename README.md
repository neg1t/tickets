# Hall Platform

Локальная демонстрация редактора схем залов и покупательского виджета.

## Запуск

Требуются Node.js 24 и pnpm 12.14.0.

```bash
pnpm install --frozen-lockfile
pnpm nx serve studio
```

Studio откроется на http://localhost:4200/. В разделе «Демо-мероприятия» можно выбрать билеты и пройти локальное оформление. Черновики залов и демо-заказы сохраняются в IndexedDB браузера. Внешний API для демо не нужен.

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
