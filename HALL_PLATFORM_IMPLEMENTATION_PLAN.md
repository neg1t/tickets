# HALL_PLATFORM_IMPLEMENTATION_PLAN.md

# Hall Platform — Master Implementation Plan

**Версия:** 2.0  
**Статус:** Approved for implementation  
**Язык документа:** русский  
**Основной стек:** Nx, React, TypeScript, Konva, React Konva, PDF.js, Effector, Axios  
**Продукт:** конфигуратор залов, интерактивная схема мест, демонстрационная билетная система и переиспользуемые SDK

---

# 0. ОБЯЗАТЕЛЬНО ПРОЧИТАТЬ ПЕРЕД РАЗРАБОТКОЙ

## 0.1. Твоя роль

Ты — ведущий архитектор и senior software engineer, отвечающий за реализацию платформы для создания, редактирования, просмотра и использования схем залов.

Твоя задача — последовательно создать **работающий, расширяемый, тестируемый и готовый к production продукт**, а не только визуальный прототип.

Ты должен:

- проектировать архитектуру;
- писать рабочий код;
- создавать тесты;
- поддерживать документацию;
- проверять работоспособность;
- устранять выявленные ошибки;
- выполнять этапы дорожной карты;
- оставлять проект в запускаемом состоянии после каждого этапа.

Не считай задачу завершённой, пока не выполнены критерии приёмки.

## 0.2. Главные архитектурные решения

Следующие решения окончательные для первоначальной архитектуры:

1. Используем **Nx Workspace** с pnpm в качестве package manager.
2. Используем **React + TypeScript**.
3. Используем **Konva + React Konva** для Canvas.
4. Используем **PDF.js** для работы с PDF.
5. Используем **Effector** для управления состоянием.
6. Используем **Axios** для интеграций с backend.
7. **Универсальные компоненты не выполняют HTTP-запросы.**
8. Компоненты получают данные через `props`.
9. Компоненты сообщают о действиях через `callbacks`.
10. Приложение-хост решает, как получать, сохранять и отправлять данные.
11. Локальное демо работает **без backend и без внешних API-запросов**.
12. Доменную модель и API-контракты проектируем самостоятельно.
13. Не адаптируемся под существующие backend-модели.
14. Flutter использует общий web viewer через WebView.
15. Редактор и покупательская схема используют общий геометрический движок.

## 0.3. Что категорически запрещено

Не допускается:

- добавлять `axios` или `fetch` непосредственно в `SeatView`;
- добавлять `axios` или `fetch` непосредственно в `HallEditor`;
- требовать `apiRoot`, `token` или URL backend для использования базовых React-компонентов;
- привязывать геометрическую модель к Konva;
- сохранять сериализованное дерево Konva как основной формат зала;
- использовать существующие backend DTO как обязательную модель;
- смешивать геометрию зала с доступностью и ценами;
- использовать глобальное состояние Effector, общее для всех экземпляров виджета;
- выполнять запросы к внешним API при обычном запуске локального демо;
- загружать PDF.js worker или шрифты с внешнего CDN;
- считать выбор места подтверждённой бронью;
- считать демонстрационный checkout настоящей оплатой;
- заявлять о прохождении тестов, которые не запускались.

## 0.4. Приоритет работы

Сначала создать минимальный сквозной сценарий:

**Создать зал → разместить места → сохранить локально → открыть схему → выбрать места → нажать «Купить» → выполнить демонстрационную покупку.**

Затем расширять редактор, работу с PDF, сложную геометрию, SDK, Flutter и production-инфраструктуру.

---

# 1. ЦЕЛЬ ПРОЕКТА

Создать универсальную платформу для проектирования и использования схем:

- театров;
- оперных театров;
- концертных залов;
- спортивных арен;
- конференц-залов;
- банкетных залов;
- клубов;
- фестивальных площадок;
- пространств со смешанной рассадкой.

Платформа должна поддерживать:

- прямые ряды;
- изогнутые ряды;
- произвольные кривые;
- сектора;
- этажи;
- балконы;
- ложи;
- проходы;
- столы;
- свободные зоны;
- отдельные места;
- сцены;
- препятствия;
- PDF-подложки;
- изображения-подложки.

## 1.1. Конечные продукты

### Hall Studio

Самостоятельное приложение для создания и редактирования залов.

### SeatView

Независимый React-компонент для отображения схемы и выбора билетов.

### HallEditor

Независимый React-компонент для создания и редактирования геометрии.

### React SDK

Библиотека для подключения компонентов в сторонние React-приложения.

### Embeddable Widget

Отдельная web-сборка для iframe и WebView.

### Flutter Wrapper

Обёртка, позволяющая использовать SeatView внутри Flutter.

### Demo Application

Автономное приложение, в котором можно попробовать все возможности без реального backend.

---

# 2. ОСНОВНОЙ ПРИНЦИП: HEADLESS INTEGRATION

## 2.1. Компоненты не знают о backend

`SeatView` должен получать готовые данные:

- геометрию зала;
- доступность;
- цены;
- выбранные места;
- состояние загрузки;
- ошибки;
- локализацию.

Компонент не должен знать:

- адрес API;
- тип авторизации;
- access token;
- структуру HTTP-запросов;
- Axios;
- способ создания заказа;
- платёжного провайдера.

## 2.2. Компоненты сообщают о действиях

Например:

- `onSelectionChange`;
- `onBuyClick`;
- `onError`;
- `onViewportChange`.

Приложение-хост самостоятельно решает, что делать при вызове callback.

## 2.3. Пример модели выбора

```ts
export type SeatSelectionItem =
  | {
      kind: "seat";
      seatId: string;
    }
  | {
      kind: "generalAdmission";
      zoneId: string;
      quantity: number;
    };

export type SeatViewData = {
  occurrenceId: string;
  selection: SeatSelectionItem[];
};
```

## 2.4. Публичный API SeatView

```tsx
export type SeatViewProps = {
  layout: PublishedHallLayout;

  occurrenceId: string;

  availability: SeatAvailabilityMap;

  prices: SeatPriceMap;

  selection: SeatSelectionItem[];

  locale?: string;

  loading?: boolean;

  buying?: boolean;

  error?: string | null;

  onSelectionChange: (selection: SeatSelectionItem[]) => void;

  onBuyClick: (data: SeatViewData) => void | Promise<void>;

  onError?: (error: Error) => void;
};
```

## 2.5. Пример использования

```tsx
function EventPage() {
  const [selection, setSelection] = React.useState<SeatSelectionItem[]>([]);

  const handleBuyClick = async (data: SeatViewData) => {
    await fetchBuy(data);
  };

  return (
    <SeatView
      layout={hallLayout}
      occurrenceId="occurrence-123"
      availability={availability}
      prices={prices}
      selection={selection}
      onSelectionChange={setSelection}
      onBuyClick={handleBuyClick}
    />
  );
}
```

Здесь `fetchBuy` принадлежит приложению-хосту.

Внутри `SeatView` не должно быть HTTP-запросов.

## 2.6. Важное разделение событий

Нажатие на отдельное место:

```text
seat clicked
    ↓
selection changed
    ↓
onSelectionChange(...)
```

Нажатие на кнопку покупки:

```text
buy button clicked
    ↓
onBuyClick(...)
    ↓
host application
    ↓
booking API / demo booking
```

`onBuyClick` означает запрос пользователя на продолжение покупки, а не подтверждение успешной оплаты.

Если callback возвращает Promise, компонент может учитывать процесс выполнения, но не должен самостоятельно объявлять покупку успешной.

Управление успешным checkout принадлежит host application.

---

# 3. HALL EDITOR: ТАКОЙ ЖЕ ПРИНЦИП

## 3.1. Публичный API

```tsx
export type HallEditorProps = {
  value: HallLayoutDraft;

  locale?: string;

  readonly?: boolean;

  saving?: boolean;

  onChange: (layout: HallLayoutDraft, meta: EditorChangeMeta) => void;

  onSave?: (layout: HallLayoutDraft) => void | Promise<void>;

  onPublish?: (layout: HallLayoutDraft) => void | Promise<void>;

  onError?: (error: Error) => void;
};
```

## 3.2. Использование в локальном приложении

```tsx
function LocalEditorPage() {
  const handleSave = async (layout: HallLayoutDraft) => {
    await localHallRepository.save(layout);
  };

  return (
    <HallEditor
      value={layout}
      onChange={handleLayoutChange}
      onSave={handleSave}
    />
  );
}
```

## 3.3. Использование с backend

```tsx
function AdminEditorPage() {
  const handleSave = async (layout: HallLayoutDraft) => {
    await api.put(`/layouts/${layout.id}/draft`, layout);
  };

  return (
    <HallEditor
      value={layout}
      onChange={handleLayoutChange}
      onSave={handleSave}
    />
  );
}
```

**Один компонент — разные реализации сохранения.**

## 3.4. Производительность onChange

Не требуется отправлять полный layout наружу при каждом пикселе движения мыши.

Внутреннее редактирование может использовать локальное состояние Effector.

`onChange` должен вызываться после завершения логической операции:

- объект перемещён;
- ряд создан;
- параметры изменены;
- группа удалена;
- нумерация обновлена.

При необходимости добавить отдельный throttled callback для предварительного состояния.

---

# 4. NX WORKSPACE

## 4.1. Инструменты

- Nx;
- pnpm;
- React;
- TypeScript;
- Vite;
- Vitest;
- Playwright;
- ESLint;
- Prettier.

Использовать совместимые актуальные версии.

Фиксировать зависимости через `pnpm-lock.yaml`.

## 4.2. Структура

```text
hall-platform/
│
├── apps/
│   ├── studio/
│   ├── embed/
│   └── showcase/
│
├── libs/
│   ├── domain/
│   ├── geometry/
│   ├── renderer-konva/
│   ├── hall-editor/
│   ├── seat-view/
│   ├── pdf/
│   ├── state/
│   ├── ui/
│   ├── local-storage/
│   ├── fixtures/
│   ├── api-contracts/
│   ├── api-axios/
│   ├── react-sdk/
│   ├── widget-bridge/
│   └── testing/
│
├── examples/
│   └── flutter/
│
├── docs/
│   ├── architecture/
│   ├── decisions/
│   ├── api/
│   ├── integrations/
│   └── user-guide/
│
├── tests/
│   ├── e2e/
│   ├── integration/
│   ├── visual/
│   └── performance/
│
├── nx.json
├── package.json
├── pnpm-lock.yaml
├── tsconfig.base.json
├── AGENTS.md
└── README.md
```

## 4.3. Назначение библиотек

### `domain`

Доменная модель, типы, инварианты, схемы валидации.

Не зависит от React, Konva, Effector или Axios.

### `geometry`

Векторная математика, кривые, координаты, генерация мест, коллизии.

Не зависит от React, Konva, Effector или Axios.

### `renderer-konva`

Рендеринг доменной модели через React Konva.

Не выполняет HTTP-запросы.

### `hall-editor`

Публичный редактор, инструменты, панели и локальная модель состояния.

### `seat-view`

Публичная схема покупателя.

### `pdf`

PDF.js, импорт и преобразование подложек.

### `state`

Переиспользуемые фабрики моделей Effector и общие события, если они действительно нужны нескольким пакетам.

Не создавать один общий глобальный store для всех виджетов.

### `local-storage`

IndexedDB, сохранение и загрузка локальных данных.

Используется приложением Studio, но не является обязательной зависимостью `HallEditor` или `SeatView`.

### `api-contracts`

OpenAPI, JSON Schema, Zod, публичные DTO.

### `api-axios`

Опциональный Axios adapter для host applications.

`SeatView` и `HallEditor` не должны зависеть от этой библиотеки.

### `react-sdk`

Публичные exports для интеграторов.

### `widget-bridge`

Протокол сообщений для iframe и Flutter WebView.

## 4.4. Nx module boundaries

Настроить Nx tags и enforce-module-boundaries.

Пример тегов:

- `scope:core`;
- `scope:rendering`;
- `scope:feature`;
- `scope:integration`;
- `scope:app`;
- `type:domain`;
- `type:ui`;
- `type:data-access`.

Правила:

- `domain` не импортирует React, Konva, Effector, Axios;
- `geometry` зависит только от `domain` и чистых утилит;
- `renderer-konva` не импортирует API-клиент;
- `seat-view` не импортирует API-клиент;
- `hall-editor` не импортирует API-клиент;
- `react-sdk` не импортирует `local-storage`;
- `apps` могут использовать интеграционные библиотеки;
- `pdf` не должен попадать в bundle покупательского виджета.

Проверять правила в CI.

---

# 5. EFFECTOR: STATE MANAGEMENT

## 5.1. Основные правила

Использовать Effector и `effector-react`.

Не использовать Zustand или Redux.

Разделять:

1. состояние доменной модели;
2. состояние редактора;
3. состояние viewport;
4. состояние выбора мест;
5. состояние приложения-хоста.

## 5.2. Hall Editor State

Пример:

```text
$draft
$selectedObjectIds
$activeTool
$viewport
$undoStack
$redoStack
$isDirty
$validationIssues
```

События:

```text
objectSelected
selectionCleared
toolChanged
objectCreated
objectUpdated
objectDeleted
undoRequested
redoRequested
validationRequested
```

## 5.3. SeatView State

Пример внутреннего состояния:

```text
$viewport
$activeFloorId
$activeZoneId
$hoveredSeatId
$focusedSeatId
$openSeatDetails
```

Выбранные места в controlled-режиме должны синхронизироваться с `selection` из props.

Не создавать второй независимый источник истины для выбора.

## 5.4. Изоляция экземпляров

Обязательное требование:

На одной странице могут находиться два экземпляра `SeatView`.

Они должны иметь независимые:

- viewport;
- активный этаж;
- hover;
- focus;
- UI overlays;
- временное состояние.

Использовать изолированные Effector scopes или фабрики моделей с корректным lifecycle.

Создавать scope один раз на экземпляр, не на каждом React render.

Не обращаться из обработчиков к глобальным events/stores в обход scope.

Написать тест, подтверждающий независимость двух одновременно открытых виджетов.

## 5.5. Async operations

Effector effects можно использовать в Studio и host application для:

- сохранения в IndexedDB;
- импорта файлов;
- экспорта JSON;
- вызовов Axios через адаптер;
- демонстрационной покупки.

Не превращать `SeatView` в сервис, который самостоятельно получает данные.

---

# 6. HTTP И AXIOS

## 6.1. Axios только на интеграционном уровне

Создать опциональную библиотеку `api-axios`.

Пример:

```ts
import axios from "axios";

export function createHallApiClient(
  baseURL: string,
  getToken?: () => string | undefined,
) {
  const client = axios.create({
    baseURL,
  });

  client.interceptors.request.use((config) => {
    const token = getToken?.();

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  });

  return client;
}
```

Это иллюстрация. Реализовать корректную обработку ошибок, отмену запросов и очистку interceptors.

## 6.2. Как использовать

Host application:

```text
Axios
  ↓
API response
  ↓
mapping / validation
  ↓
React props
  ↓
SeatView
```

В обратную сторону:

```text
SeatView
  ↓
onBuyClick
  ↓
host application
  ↓
Axios
  ↓
backend
```

## 6.3. API-клиент необязателен

Пользователь библиотеки может использовать:

- Axios;
- Fetch;
- GraphQL;
- собственный SDK;
- локальный JSON;
- IndexedDB;
- любую другую систему.

Наш официальный интеграционный пример использует Axios.

---

# 7. ПОЛНОСТЬЮ АВТОНОМНЫЙ LOCAL DEMO

## 7.1. Обязательное требование

При обычном локальном запуске приложения **не должно быть обращений к backend или внешним сервисам**.

Допускается загрузка локальных файлов приложения с dev-сервера.

Запрещены runtime-запросы к:

- внешнему API;
- CDN;
- удалённым шрифтам;
- аналитике;
- удалённым PDF workers;
- сервисам бронирования.

Установка npm-зависимостей при первоначальной настройке, естественно, может требовать доступа к package registry. Требование автономности относится к работе уже установленного приложения.

## 7.2. Локальное хранение

Использовать IndexedDB.

Создать:

```ts
interface LocalHallRepository {
  list(): Promise<HallSummary[]>;

  get(id: string): Promise<HallLayoutDraft | null>;

  save(layout: HallLayoutDraft): Promise<void>;

  delete(id: string): Promise<void>;
}
```

Дополнительно:

- импорт JSON;
- экспорт JSON;
- создание копии;
- восстановление fixtures;
- сброс демо-данных.

## 7.3. Демо-покупка

Должна работать полностью локально.

Сценарий:

1. Пользователь открывает тестовый occurrence.
2. Выбирает места.
3. Нажимает «Купить».
4. Studio получает `onBuyClick`.
5. Локальный booking service проверяет доступность.
6. Создаёт демонстрационный hold.
7. Показывает экран подтверждения.
8. Помечает места проданными в локальном demo inventory.
9. Формирует демонстрационное подтверждение.

Никакого HTTP.

Не считать локальный hold защитой от конкурирующих покупателей в production.

## 7.4. Demo Mode и API Mode

Studio должен поддерживать явную конфигурацию:

```ts
type AppMode = "local" | "api";
```

По умолчанию:

```ts
const mode: AppMode = "local";
```

В режиме `local` Axios adapter вообще не инициализируется.

В режиме `api` host application использует Axios.

Переключение режима не должно менять публичный API `HallEditor` и `SeatView`.

---

# 8. ДОМЕННАЯ МОДЕЛЬ

## 8.1. Главный принцип

Мы проектируем доменную модель самостоятельно.

Backend реализует согласованные нами контракты.

Существующие backend-модели не являются ограничением.

## 8.2. Основные сущности

### Venue

Физическая площадка.

### Hall

Зал внутри площадки.

### Layout

Логическая схема зала.

### LayoutVersion

Конкретная версия схемы.

### Floor

Этаж или уровень.

### Zone

Сектор или область.

### Row

Редактируемый ряд.

### Seat

Конкретное место со стабильным ID.

### Table

Стол с местами.

### Aisle

Проход.

### Stage

Сцена.

### Obstacle

Препятствие.

### Annotation

Вспомогательная подпись или графика.

### Background

PDF или изображение-подложка.

## 8.3. Геометрия и продажи разделены

Геометрия:

```text
Hall
  ↓
Layout
  ↓
LayoutVersion
  ↓
Floor
  ↓
Zone / Row / Seat / Table
```

Продажи:

```text
Event
  ↓
Occurrence
  ↓
Seat Inventory
  ↓
Hold / Order / Checkout
```

Одно и то же место может иметь разные цены и доступность на разных мероприятиях.

## 8.4. Координаты

Использовать единую систему координат зала:

- начало — верхний левый угол;
- X вправо;
- Y вниз;
- единицы — логические world units;
- преобразование в экранные пиксели выполняет renderer.

Для физических измерений хранить отдельную калибровку с переводом world units в миллиметры.

Не объявлять условные координаты физическими миллиметрами без калибровки.

Поддержать:

- world coordinates;
- PDF coordinates;
- viewport coordinates;
- device pixels.

Написать тесты прямого и обратного преобразования.

## 8.5. Стабильные идентификаторы

Каждое место имеет постоянный `id`.

Изменение формы ряда не должно автоматически пересоздавать все места.

При изменении количества мест реализовать reconciliation:

- сохранить соответствующие ID;
- создать ID новых мест;
- определить удаляемые;
- предупредить о последствиях для опубликованных схем.

---

# 9. КРИВЫЕ РЯДЫ

## 9.1. Типы

```ts
type RowCurve =
  | {
      kind: "line";
      start: Point;
      end: Point;
    }
  | {
      kind: "arc";
      center: Point;
      radius: number;
      startAngle: number;
      endAngle: number;
    }
  | {
      kind: "bezier";
      p0: Point;
      p1: Point;
      p2: Point;
      p3: Point;
    }
  | {
      kind: "polyline";
      points: Point[];
    };
```

Зафиксировать единицу измерения углов, например радианы.

## 9.2. Размещение мест

Реализовать:

- равномерное распределение по длине кривой;
- распределение с фиксированным шагом;
- отступы от краёв;
- направление нумерации;
- пропуски;
- разрывы;
- ориентацию по касательной;
- ручные корректировки.

Для Безье распределять места по длине кривой, а не по равномерному параметру `t`.

## 9.3. Редактирование

Пользователь должен иметь возможность:

- изменять радиус дуги;
- изменять начальный и конечный углы;
- перемещать контрольные точки;
- менять количество мест;
- менять шаг;
- менять направление посадки;
- изменять нумерацию.

---

# 10. МОДЕЛЬ СТОЛОВ

Поддержать:

- круглые столы;
- прямоугольные столы;
- места вокруг стола;
- исключение отдельных сторон;
- изменение количества мест;
- поворот;
- перемещение;
- нумерацию столов;
- нумерацию мест за столом.

Стол и места должны иметь собственные стабильные ID.

---

# 11. ВЕРСИОНИРОВАНИЕ

## 11.1. Статусы

- `draft`;
- `published`;
- `archived`.

## 11.2. Правила

1. Черновик можно редактировать.
2. Опубликованная версия неизменяема.
3. Новая публикация создаёт новую версию.
4. Occurrence ссылается на конкретную опубликованную версию.
5. Изменение черновика не влияет на уже опубликованную схему.
6. Нельзя незаметно менять идентичность проданных мест.
7. Конфликты редактирования должны обнаруживаться.

## 11.3. Local Demo

В локальном режиме эти правила должны работать так же, как предполагается в production.

---

# 12. PDF.JS И ПОДЛОЖКИ

## 12.1. Форматы

- PDF;
- PNG;
- JPG;
- при необходимости WebP.

## 12.2. Возможности

- загрузка файла;
- выбор страницы PDF;
- предпросмотр;
- масштаб;
- поворот;
- прозрачность;
- блокировка;
- скрытие;
- удаление;
- замена файла;
- несколько подложек;
- привязка к этажу;
- калибровка.

## 12.3. Калибровка

Поддержать:

- выбор двух точек;
- ввод известного расстояния;
- вычисление масштаба;
- сохранение преобразования;
- статус отсутствия калибровки.

## 12.4. Важное ограничение

PDF.js не распознаёт места автоматически.

Пользователь вручную создаёт редактируемую геометрию поверх трафарета.

Автоматическое распознавание PDF не входит в MVP.

## 12.5. Offline

PDF.js worker должен поставляться с приложением.

Не использовать внешний CDN.

---

# 13. CANVAS RENDERER

## 13.1. Слои

- background;
- static geometry;
- zones;
- rows and seats;
- interaction;
- selection;
- guides.

Не создавать отдельный Konva Layer для каждого места.

## 13.2. Навигация

- zoom;
- pan;
- pinch zoom;
- fit-to-screen;
- zoom-to-selection;
- zoom-to-zone;
- reset viewport.

Масштабирование должно учитывать положение курсора или точку жеста.

## 13.3. Выделение

- одно место;
- несколько мест;
- ряд;
- зона;
- стол;
- группа объектов.

## 13.4. Уровни детализации

При далёком масштабе:

- сектора;
- контуры;
- названия.

При среднем:

- места;
- цвета;
- минимальные подписи.

При близком:

- номера;
- подробные состояния;
- взаимодействия.

---

# 14. HALL STUDIO

## 14.1. Страницы

```text
/
  Dashboard

/halls
  Hall Catalog

/halls/new
  Create Hall

/halls/:id/edit
  Hall Editor

/halls/:id/preview
  Hall Preview

/halls/:id/versions
  Version History

/demo/events
  Demo Events

/demo/events/:occurrenceId
  SeatView Demo

/sdk
  Integration Examples
```

## 14.2. Редактор

Верхняя панель:

- название;
- статус;
- сохранить;
- undo;
- redo;
- валидация;
- preview;
- публикация.

Левая панель:

- select;
- hand;
- zone;
- straight row;
- arc row;
- Bezier row;
- individual seat;
- table;
- aisle;
- stage;
- obstacle;
- annotation.

Центр:

- Canvas.

Правая панель:

- свойства объекта.

Нижняя панель:

- ошибки;
- предупреждения;
- статус изменений.

## 14.3. Обязательные операции

- создание;
- перемещение;
- поворот;
- изменение размеров;
- дублирование;
- удаление;
- массовое выделение;
- групповое редактирование;
- нумерация;
- изменение параметров рядов;
- undo/redo;
- copy/paste;
- работа с этажами;
- работа с подложками.

## 14.4. Command Pattern

Для undo/redo использовать команды:

- `CreateObject`;
- `DeleteObjects`;
- `MoveObjects`;
- `UpdateRowCurve`;
- `RenumberSeats`;
- `DuplicateObjects`;
- `UpdateZone`.

Не сохранять полную копию всего layout на каждый пиксель drag.

---

# 15. SEATVIEW

## 15.1. Функциональность

- просмотр опубликованного layout;
- переключение этажей;
- выбор сектора;
- масштабирование;
- выбор мест;
- снятие выбора;
- отображение доступности;
- отображение цен;
- легенда;
- корзина;
- кнопка покупки;
- mobile UX.

## 15.2. Статусы мест

- `available`;
- `held`;
- `sold`;
- `blocked`;
- `unavailable`.

`selected` является состоянием выбора в UI и не заменяет серверный статус.

## 15.3. Цена и статус

Не смешивать статус места с ценовой категорией.

Цена, категория и доступность — отдельные данные.

## 15.4. Controlled selection

Основной публичный API должен быть controlled:

```tsx
<SeatView
  selection={selection}
  onSelectionChange={setSelection}
  // ...
/>
```

Внутреннее состояние Effector может отвечать за viewport, hover и другие UI-детали.

## 15.5. Покупка

При нажатии на «Купить»:

```tsx
onBuyClick({
  occurrenceId,
  selection,
});
```

Никаких HTTP-запросов внутри компонента.

---

# 16. DEMO DATA

Создать готовые примеры.

## Example A — Small Theater

- прямые ряды;
- два-три сектора;
- проходы;
- нумерация.

## Example B — Opera Hall

- дуговые ряды;
- сложная геометрия;
- несколько уровней;
- ложи.

## Example C — Arena

- много секторов;
- большое количество мест;
- нагрузочные тесты.

## Example D — Conference / Banquet Hall

- круглые столы;
- прямоугольные столы;
- места вокруг столов;
- свободные зоны.

Для каждого примера:

- редактируемый layout;
- опубликованная версия;
- demo occurrence;
- цены;
- доступность;
- демонстрационная покупка.

Если реальные PDF-схемы доступны агенту, использовать их для проверки. Если недоступны — не выдумывать их содержимое, а использовать синтетические fixtures до получения исходников.

---

# 17. API CONTRACTS ДЛЯ BACKEND

## 17.1. Важно

Мы проектируем API, но базовые React-компоненты его не вызывают.

Контракты нужны:

- backend-разработчику;
- официальному Axios adapter;
- host applications;
- интеграционным тестам.

## 17.2. Формат

Использовать:

- OpenAPI 3.1;
- JSON Schema;
- Zod;
- версионирование API.

## 17.3. Hall API

```text
GET    /api/v1/halls
POST   /api/v1/halls
GET    /api/v1/halls/{id}

GET    /api/v1/halls/{id}/layouts
POST   /api/v1/halls/{id}/layouts

GET    /api/v1/layouts/{id}/draft
PUT    /api/v1/layouts/{id}/draft
POST   /api/v1/layouts/{id}/validate
POST   /api/v1/layouts/{id}/publish

GET    /api/v1/layouts/{id}/versions
GET    /api/v1/layout-versions/{id}
```

## 17.4. Assets API

```text
POST   /api/v1/assets/upload-intents
POST   /api/v1/assets/{id}/complete
GET    /api/v1/assets/{id}
DELETE /api/v1/assets/{id}
```

## 17.5. Occurrence API

```text
GET    /api/v1/occurrences/{id}
GET    /api/v1/occurrences/{id}/seat-map
GET    /api/v1/occurrences/{id}/availability
GET    /api/v1/occurrences/{id}/prices
```

## 17.6. Booking API

```text
POST   /api/v1/occurrences/{id}/holds
GET    /api/v1/holds/{id}
DELETE /api/v1/holds/{id}

POST   /api/v1/orders
GET    /api/v1/orders/{id}
POST   /api/v1/orders/{id}/checkout
```

Это проектируемые контракты, а не утверждение о существовании таких endpoints.

## 17.7. Серверные гарантии

Backend обязан обеспечивать:

- авторизацию;
- права доступа;
- атомарное резервирование;
- TTL holds;
- idempotency;
- серверную проверку цен;
- серверную проверку доступности;
- optimistic concurrency;
- неизменяемость опубликованных layout;
- безопасную обработку файлов.

---

# 18. REACT SDK

## 18.1. Публичные exports

```tsx
import { HallEditor, HallViewer, SeatView } from "@hall/react-sdk";
```

Желательно поддержать независимые entrypoints:

```tsx
import { SeatView } from "@hall/react-sdk/seat-view";

import { HallEditor } from "@hall/react-sdk/editor";
```

## 18.2. Требования

- ESM;
- TypeScript declarations;
- tree-shaking;
- независимые entrypoints;
- lazy loading;
- темы;
- локализация;
- обработка ошибок;
- корректный unmount;
- отсутствие глобальных CSS-конфликтов.

## 18.3. Размер bundle

Импорт `SeatView` не должен загружать:

- PDF.js;
- инструменты редактора;
- IndexedDB adapter;
- Axios adapter.

Проверять это автоматизированным bundle analysis.

## 18.4. Несколько экземпляров

На одной странице должны корректно работать два независимых `SeatView`.

Написать соответствующий тест.

---

# 19. EMBED И FLUTTER

## 19.1. Общий принцип

Для Flutter не создаём отдельный рендерер на Dart.

Используем web-версию `SeatView` внутри WebView.

## 19.2. Embed application

Приложение `apps/embed` должно быть тонкой оболочкой над `SeatView`.

Оно получает данные через message bridge.

По умолчанию не делает API-запросов.

## 19.3. Browser iframe

Host application:

1. создаёт iframe;
2. ждёт `ready`;
3. передаёт layout, availability, prices и selection;
4. получает `selectionChanged`;
5. получает `buyClicked`;
6. самостоятельно выполняет покупку.

## 19.4. Протокол сообщений

Каждое сообщение:

```ts
type BridgeMessage = {
  protocolVersion: 1;
  type: string;
  requestId?: string;
  payload?: unknown;
};
```

События из виджета:

- `ready`;
- `selectionChanged`;
- `buyClicked`;
- `error`;
- `closeRequested`.

Команды виджету:

- `initialize`;
- `updateLayout`;
- `updateAvailability`;
- `updatePrices`;
- `updateSelection`;
- `setLocale`;
- `dispose`.

Валидировать сообщения runtime-схемами.

## 19.5. Безопасность iframe

- проверять origin;
- проверять source;
- использовать конкретный targetOrigin;
- не передавать токены в URL;
- не доверять входящим сообщениям;
- настроить CSP.

## 19.6. Flutter Mobile

Использовать `webview_flutter`.

Создать Flutter wrapper с API примерно следующего вида:

```dart
SeatViewWidget(
  layout: layout,
  availability: availability,
  prices: prices,
  selection: selection,
  locale: 'ru',
  onSelectionChange: (selection) {},
  onBuyClick: (data) {},
)
```

Flutter wrapper должен:

- открыть WebView;
- загрузить embed-приложение;
- передать данные;
- получать события;
- преобразовывать события в Dart callbacks.

## 19.7. Flutter offline demo

Для автономного мобильного демо исследовать и реализовать загрузку собранных web assets из локального bundle Flutter, если выбранный WebView и необходимые ресурсы корректно поддерживают такой режим.

Если для конкретной платформы потребуется локальный asset server или другая схема загрузки, задокументировать её и покрыть тестами.

Production может использовать HTTPS-hosted embed application.

## 19.8. Flutter Web

Использовать iframe или HTML platform view.

Не предполагать, что `webview_flutter` работает в Flutter Web.

---

# 20. ПРОИЗВОДИТЕЛЬНОСТЬ

## 20.1. Тестовые размеры

- 500 мест;
- 2 000 мест;
- 5 000 мест;
- 10 000 мест;
- 50 000 мест — стресс-тест.

## 20.2. Измерять

- время загрузки;
- время рендеринга;
- FPS при pan;
- FPS при zoom;
- задержку выбора;
- расход памяти;
- размер bundle;
- количество Konva nodes;
- количество React rerenders.

## 20.3. Оптимизации

По результатам профилирования:

- viewport culling;
- spatial index;
- LOD;
- batching;
- selective caching;
- custom Konva Shape;
- оптимизация hit-testing;
- lazy loading;
- минимизация обновлений Effector.

## 20.4. Ориентиры

Стремиться к:

- около 60 FPS на современном desktop;
- не ниже примерно 30 FPS на согласованном мобильном устройстве;
- отсутствию длительных зависаний при массовых операциях.

Зафиксировать реальные пороги после performance baseline.

---

# 21. ТЕСТИРОВАНИЕ

## 21.1. Unit tests

- геометрия;
- кривые;
- координаты;
- распределение мест;
- нумерация;
- ID;
- полигоны;
- таблицы мест;
- undo/redo;
- Effector models;
- валидация.

## 21.2. Component tests

- SeatView controlled selection;
- HallEditor callbacks;
- корректное отображение статусов;
- loading/error states;
- несколько независимых экземпляров.

## 21.3. E2E

Сценарий:

1. Запустить Studio.
2. Создать зал.
3. Добавить этаж.
4. Загрузить PDF.
5. Создать сектор.
6. Создать дуговой ряд.
7. Пронумеровать места.
8. Сохранить.
9. Перезагрузить страницу.
10. Проверить геометрию.
11. Опубликовать.
12. Создать demo occurrence.
13. Открыть SeatView.
14. Выбрать места.
15. Нажать «Купить».
16. Завершить demo checkout.

## 21.4. Offline test

Обязательный автоматический тест:

- запустить Studio в local mode;
- заблокировать внешние HTTP-запросы;
- выполнить основные пользовательские сценарии;
- убедиться, что приложение работает.

Любая неожиданная попытка обращения к внешнему API должна приводить к провалу теста.

## 21.5. API adapter tests

Отдельно тестировать Axios adapter.

Использовать контролируемые HTTP mocks.

Проверять:

- авторизацию;
- ошибки;
- отмену запросов;
- timeout;
- некорректные ответы;
- валидацию DTO;
- idempotency.

## 21.6. Booking concurrency

Серверные интеграционные тесты должны проверять, что два клиента не могут успешно зарезервировать одно и то же место одновременно.

Это ответственность backend, но требование должно быть отражено в API specification.

---

# 22. БЕЗОПАСНОСТЬ

- не хранить секреты в frontend;
- не передавать токены через URL;
- не логировать токены;
- не доверять цене из SeatView;
- не доверять выбранным местам без серверной проверки;
- валидировать JSON;
- проверять iframe messages;
- ограничивать загрузку файлов;
- корректно обрабатывать 401/403;
- не обрабатывать карточные данные самостоятельно.

Демонстрационная покупка не должна использовать реальные платёжные данные.

---

# 23. ЛОКАЛЬНЫЙ ЗАПУСК

## 23.1. Bootstrap

Создать Nx Workspace с pnpm.

Начальная команда:

```bash
pnpm dlx create-nx-workspace@latest hall-platform --pm=pnpm
```

Выбрать конфигурацию с поддержкой React и Vite либо добавить необходимые Nx plugins после создания workspace.

Поскольку CLI Nx может меняться, проверить доступные generators в установленной версии перед выполнением следующих команд.

## 23.2. Целевые команды

Обеспечить:

```bash
pnpm install

pnpm nx serve studio

pnpm nx serve embed

pnpm nx build studio

pnpm nx build embed

pnpm nx run-many -t test

pnpm nx run-many -t lint

pnpm nx run-many -t typecheck
```

Добавить удобные scripts в корневой `package.json`.

## 23.3. Default mode

По умолчанию Studio должен работать в локальном режиме.

Никаких обязательных переменных окружения для backend.

## 23.4. API mode

Для реальной интеграции:

```env
VITE_APP_MODE=api
VITE_API_ROOT=https://api.example.com
```

`VITE_` переменные являются публичными для клиентской сборки.

Не хранить в них секреты.

---

# 24. ДОРОЖНАЯ КАРТА

## Phase 00 — Nx Bootstrap

**Цель:** рабочий Nx Workspace.

Задачи:

- создать workspace;
- настроить pnpm;
- добавить React/Vite;
- создать Studio;
- создать Embed;
- настроить ESLint;
- настроить TypeScript;
- настроить Vitest;
- настроить Playwright;
- настроить CI;
- настроить Nx module boundaries.

**Готово, когда:**

- Studio запускается;
- Embed запускается;
- build проходит;
- typecheck проходит;
- тесты проходят.

## Phase 01 — Domain Model

**Цель:** независимая доменная модель.

Задачи:

- Hall;
- Layout;
- Floor;
- Zone;
- Row;
- Seat;
- Table;
- Background;
- Occurrence;
- Inventory;
- идентификаторы;
- координаты;
- версии;
- Zod schemas;
- JSON fixtures.

**Готово, когда:**

- модель не зависит от UI;
- сериализация работает;
- схемы валидируются;
- есть unit-тесты.

## Phase 02 — Geometry Engine

**Цель:** генерация геометрии.

Задачи:

- векторы;
- матрицы;
- линии;
- дуги;
- Безье;
- полигоны;
- генераторы рядов;
- генераторы столов;
- коллизии;
- spatial index.

**Готово, когда:**

- прямые и дуговые ряды работают;
- ID сохраняются;
- тесты проходят.

## Phase 03 — Konva Renderer

**Цель:** отображение зала.

Задачи:

- Stage;
- Layers;
- Zoom;
- Pan;
- Fit;
- Hit-testing;
- Rendering;
- Selection.

**Готово, когда:**

- можно открыть тестовый зал;
- масштабировать;
- перемещать;
- выбирать объекты.

## Phase 04 — Basic HallEditor

**Цель:** редактирование без PDF.

Задачи:

- editor shell;
- инструменты;
- зоны;
- ряды;
- места;
- столы;
- свойства;
- undo/redo;
- callbacks.

**Готово, когда:**

- можно создать зал;
- изменить геометрию;
- получить результат через `onChange`.

## Phase 05 — PDF Integration

**Цель:** работа поверх подложек.

Задачи:

- PDF.js;
- импорт;
- выбор страницы;
- масштаб;
- поворот;
- калибровка;
- сохранение преобразований.

**Готово, когда:**

- пользователь загружает PDF;
- рисует поверх него;
- после повторного открытия объекты не смещаются.

## Phase 06 — Local Persistence

**Цель:** автономное Studio.

Задачи:

- IndexedDB;
- local repository;
- каталог залов;
- импорт/экспорт;
- черновики;
- публикация;
- fixtures.

**Готово, когда:**

- приложение работает без backend;
- данные сохраняются;
- готовые залы открываются.

## Phase 07 — SeatView

**Цель:** покупательская схема.

Задачи:

- независимый компонент;
- controlled selection;
- статусы;
- цены;
- этажи;
- сектора;
- mobile UX;
- `onBuyClick`.

**Готово, когда:**

- SeatView не делает HTTP;
- выбор работает;
- callbacks работают;
- два экземпляра независимы.

## Phase 08 — Demo Booking

**Цель:** локальная демонстрационная покупка.

Задачи:

- demo occurrences;
- demo inventory;
- локальные holds;
- demo checkout;
- подтверждение;
- обновление статусов.

**Готово, когда:**

- полный сценарий покупки работает без сети.

## Phase 09 — API Contracts & Axios

**Цель:** интеграция с backend.

Задачи:

- OpenAPI;
- DTO;
- Axios adapter;
- mapping;
- validation;
- examples;
- integration tests.

**Готово, когда:**

- backend-разработчик получает полную спецификацию;
- Studio может переключиться на API mode;
- базовые компоненты не изменяются.

## Phase 10 — React SDK

**Цель:** подключение компонентов в сторонние приложения.

Задачи:

- package builds;
- exports;
- typings;
- Storybook;
- examples;
- bundle analysis.

**Готово, когда:**

- отдельный React host использует HallEditor;
- отдельный React host использует SeatView;
- Axios не является обязательной зависимостью компонентов.

## Phase 11 — Embed & Flutter

**Цель:** встраивание.

Задачи:

- embed application;
- message bridge;
- iframe example;
- Flutter wrapper;
- Android/iOS tests;
- Flutter Web example.

**Готово, когда:**

- выбор мест работает во Flutter;
- событие покупки приходит в Dart;
- API-запрос выполняет host.

## Phase 12 — Performance & QA

**Цель:** устойчивость на больших схемах.

Задачи:

- profiling;
- LOD;
- culling;
- spatial indexing;
- performance tests;
- visual regression;
- security review;
- accessibility.

**Готово, когда:**

- выполнены согласованные performance thresholds;
- критические тесты проходят;
- реальные сложные схемы проверены.

## Phase 13 — Production Release

**Цель:** стабильный выпуск.

Задачи:

- staging;
- production builds;
- monitoring;
- CI/CD;
- документация;
- versioning;
- rollback;
- release notes.

**Готово, когда:**

- есть воспроизводимая сборка;
- есть deployment guide;
- есть rollback;
- SDK готов к интеграции.

---

# 25. ПЕРВЫЕ 10 РАБОЧИХ ДНЕЙ

## День 1

- Nx Workspace;
- React/Vite;
- TypeScript;
- Konva;
- пустой Stage.

## День 2

- доменные типы;
- система координат;
- zoom/pan;
- unit-тесты.

## День 3

- генерация прямого ряда;
- места;
- нумерация.

## День 4

- дуговой ряд;
- ориентация мест;
- выбор объектов.

## День 5

- первый SeatView;
- выбор мест;
- callbacks.

## День 6

- PDF.js;
- загрузка PDF.

## День 7

- подложка;
- масштаб;
- поворот;
- калибровка.

## День 8

- зоны поверх PDF;
- генерация рядов поверх подложки.

## День 9

- редактор;
- свойства;
- undo/redo.

## День 10

- IndexedDB;
- сохранение;
- повторное открытие;
- первый E2E.

**Результат первых двух недель:** можно загрузить PDF, создать часть зала, сохранить её, открыть SeatView и выбрать места.

---

# 26. ТЕСТОВЫЕ СХЕМЫ

При наличии исходных PDF использовать реальные планы:

- театральные залы;
- оперные залы;
- большие концертные залы;
- арены;
- залы с несколькими уровнями.

Не предполагать, что все PDF одинаковые.

Проверять:

- дуговые ряды;
- сложные полигоны;
- проходы;
- балконы;
- ложи;
- большие сектора;
- много мест.

Если исходные файлы отсутствуют в рабочем окружении, продолжать с fixtures и зафиксировать необходимость получить их для финальной приёмки.

---

# 27. ДОКУМЕНТАЦИЯ

Обязательно создать:

```text
README.md
AGENTS.md
CONTRIBUTING.md
CHANGELOG.md

docs/architecture/overview.md
docs/architecture/domain-model.md
docs/architecture/geometry.md
docs/architecture/state-management.md
docs/architecture/component-contracts.md
docs/architecture/versioning.md

docs/api/openapi.yaml
docs/api/backend-guide.md

docs/integrations/react.md
docs/integrations/axios.md
docs/integrations/iframe.md
docs/integrations/flutter.md

docs/user-guide/editor.md
docs/user-guide/seat-view.md

docs/decisions/
```

`AGENTS.md` должен ссылаться на этот мастер-план и содержать основные архитектурные запреты.

---

# 28. DEFINITION OF DONE

Каждая задача считается завершённой, если:

- реализована;
- типизирована;
- протестирована;
- проверена в браузере;
- не нарушает Nx boundaries;
- не создаёт неожиданных HTTP-запросов;
- не ломает публичные callbacks;
- не нарушает стабильность ID;
- не ломает существующие сценарии;
- документирована при необходимости.

После каждого этапа агент должен сообщать:

1. Что сделано.
2. Какие файлы изменены.
3. Как запустить.
4. Какие тесты выполнены.
5. Какие ограничения остались.
6. Что будет следующим этапом.

---

# 29. PRODUCTION CHECKLIST

## Architecture

- [ ] Nx Workspace настроен.
- [ ] Effector используется корректно.
- [ ] Модели компонентов изолированы.
- [ ] Геометрия не зависит от UI.
- [ ] Компоненты не делают HTTP.
- [ ] Axios изолирован в integration layer.
- [ ] Nx boundaries проверяются автоматически.

## HallEditor

- [ ] Зоны.
- [ ] Прямые ряды.
- [ ] Дуговые ряды.
- [ ] Безье.
- [ ] Столы.
- [ ] Проходы.
- [ ] Этажи.
- [ ] PDF.
- [ ] Калибровка.
- [ ] Undo/redo.
- [ ] Сохранение.
- [ ] Публикация.

## SeatView

- [ ] Controlled selection.
- [ ] Доступность.
- [ ] Цены.
- [ ] Этажи.
- [ ] Сектора.
- [ ] General admission.
- [ ] Mobile UX.
- [ ] `onBuyClick`.
- [ ] Несколько независимых экземпляров.
- [ ] Доступная альтернативная навигация по местам.

## Demo

- [ ] Полностью автономный режим.
- [ ] Нет внешних API-запросов.
- [ ] IndexedDB.
- [ ] Готовые залы.
- [ ] Демо-мероприятия.
- [ ] Демо-покупка.
- [ ] Импорт/экспорт JSON.

## SDK

- [ ] React SDK.
- [ ] Типы TypeScript.
- [ ] Независимые entrypoints.
- [ ] Tree-shaking.
- [ ] iframe.
- [ ] Flutter.
- [ ] Документация.

## Production

- [ ] Unit tests.
- [ ] Integration tests.
- [ ] E2E tests.
- [ ] Offline tests.
- [ ] Performance tests.
- [ ] Security review.
- [ ] CI/CD.
- [ ] Staging.
- [ ] Monitoring.
- [ ] Rollback.
- [ ] Release notes.

---

# 30. ЧТО НЕ ВХОДИТ В MVP

Без отдельного решения не реализовывать:

- AI-распознавание мест по PDF;
- 3D-залы;
- виртуальный вид с кресла;
- собственный платёжный процессинг;
- CRM;
- бухгалтерию;
- динамическое ценообразование;
- native Flutter Canvas-рендерер;
- автоматическую юридическую проверку эвакуационных нормативов.

---

# 31. ФИНАЛЬНЫЕ ПРИЁМОЧНЫЕ СЦЕНАРИИ

## Scenario A — Create Hall

Создать зал с нуля, добавить этажи, зоны, ряды, столы и проходы.

## Scenario B — PDF Tracing

Загрузить PDF, откалибровать, построить геометрию поверх него.

## Scenario C — Persistence

Сохранить зал, перезагрузить приложение и получить идентичную геометрию.

## Scenario D — Versioning

Опубликовать схему, изменить черновик и убедиться, что опубликованная версия не изменилась.

## Scenario E — SeatView

Открыть схему, выбрать места и получить корректный `onSelectionChange`.

## Scenario F — Buy Callback

Нажать «Купить» и убедиться, что вызван `onBuyClick` с правильными данными.

## Scenario G — Offline Demo

Отключить доступ к внешней сети и пройти демонстрационную покупку.

## Scenario H — React SDK

Подключить `HallEditor` и `SeatView` в отдельное React-приложение.

## Scenario I — Axios Integration

Подключить Axios в host application без изменения исходного кода компонентов.

## Scenario J — Flutter

Открыть SeatView через WebView и получить событие покупки в Dart.

## Scenario K — Large Arena

Открыть большую схему, выполнить zoom/pan, выбрать места и измерить производительность.

## Scenario L — Multiple Widgets

Отобразить два независимых SeatView на одной странице и убедиться, что их состояния не пересекаются.

---

# 32. ФИНАЛЬНАЯ ИНСТРУКЦИЯ АГЕНТУ

Начинай реализацию с Phase 00 и Phase 01.

Используй:

- Nx;
- pnpm;
- React;
- TypeScript;
- Konva;
- React Konva;
- PDF.js;
- Effector;
- Axios только для интеграций.

**Самое главное:**

`HallEditor` и `SeatView` — самостоятельные компоненты.

Они получают данные через props и сообщают о действиях через callbacks.

Они не должны знать, откуда пришли данные и что происходит после нажатия «Купить».

Локальное Studio должно работать без backend и без внешних API-запросов.

Доменную модель и API-контракты определяем мы, а не существующий backend.

Flutter использует тот же SeatView через WebView и bridge.

Создавай работающий продукт поэтапно, проверяй результаты и поддерживай архитектурную чистоту.

**Начинай реализацию.**
