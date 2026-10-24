import { createContext } from 'react';

export const EditorLocaleContext = createContext<string | undefined>(undefined);

const english: Record<string, string> = {
  'Редактор зала': 'Hall editor',
  'Схема зала': 'Hall layout',
  'Управление схемой': 'Layout controls',
  Увеличить: 'Zoom in',
  Уменьшить: 'Zoom out',
  Вписать: 'Fit',
  'К выбранному': 'Zoom to selection',
  'Приблизить зону': 'Zoom to zone',
  'Все зоны': 'All zones',
  Этаж: 'Floor',
  Масштаб: 'Scale',
  Выбрано: 'Selected',
  'Сетка · шаг 1': 'Grid · step 1',
  'Подложка:': 'Background:',
  отображается: 'visible',
  'загрузка…': 'loading…',
  Черновик: 'Draft',
  зон: 'zones',
  рядов: 'rows',
  мест: 'seats',
  столов: 'tables',
  Отменить: 'Undo',
  Повторить: 'Redo',
  'Сохранение…': 'Saving…',
  Сохранить: 'Save',
  Опубликовать: 'Publish',
  'Инструменты холста': 'Canvas tools',
  'Структура и настройки': 'Structure and settings',
  Инструменты: 'Tools',
  Структура: 'Structure',
  'Свойства объекта': 'Object properties',
  Свойства: 'Properties',
  'Закрыть панель': 'Close panel',
  Выбор: 'Select',
  Рука: 'Pan',
  Зона: 'Zone',
  'GA-зона': 'GA zone',
  Сцена: 'Stage',
  Подпись: 'Label',
  Препятствие: 'Obstacle',
  'Прямой ряд': 'Straight row',
  'Дуговой ряд': 'Arc row',
  'Ряд Безье': 'Bezier row',
  Место: 'Seat',
  'Круглый стол': 'Round table',
  'Прямоугольный стол': 'Rectangular table',
  Калибровать: 'Calibrate',
  Этажи: 'Floors',
  'Активный этаж': 'Active floor',
  'Добавить этаж': 'Add floor',
  'Название этажа': 'Floor name',
  'Удалить этаж': 'Delete floor',
  'Зона для новых объектов': 'Zone for new objects',
  'Без зоны': 'No zone',
  'PDF-подложки': 'PDF backgrounds',
  'Загрузить PDF': 'Upload PDF',
  'Чтение PDF…': 'Reading PDF…',
  страница: 'page',
  страницы: 'pages',
  Калибровка: 'Calibration',
  'Известное расстояние (мм)': 'Known distance (mm)',
  мм: 'mm',
  'мм/ед': 'mm/unit',
  'Калибровка отсутствует': 'No calibration',
  'Шаг 1 из 2': 'Step 1 of 2',
  'Шаг 2 из 2': 'Step 2 of 2',
  'Выберите первую точку на PDF или схеме.':
    'Select the first point on the PDF or layout.',
  'Выберите вторую точку на известном расстоянии.':
    'Select the second point at the known distance.',
  Предпросмотр: 'Preview',
  'ед.': 'units',
  рад: 'rad',
  'Разные значения': 'Mixed values',
  'Начните схему зала': 'Start your hall layout',
  'Выберите основу, затем двигайте объекты прямо на холсте.':
    'Choose a starting point, then move objects directly on the canvas.',
  'Готовый шаблон': 'Starter template',
  'Добавить ряд': 'Add row',
  'Добавить стол': 'Add table',
  'Импортировать PDF': 'Import PDF',
  'PDF-подложка': 'PDF background',
  'Выберите объект на схеме или подложку в списке.':
    'Select an object on the layout or a background in the list.',
  'Операции с выделением': 'Selection actions',
  Дублировать: 'Duplicate',
  Копировать: 'Copy',
  Вставить: 'Paste',
  'По левому краю': 'Align left',
  'По центру X': 'Align center X',
  'По правому краю': 'Align right',
  'По верхнему краю': 'Align top',
  'По центру Y': 'Align center Y',
  'По нижнему краю': 'Align bottom',
  'Распределить X': 'Distribute X',
  'Распределить Y': 'Distribute Y',
  'Общие координаты': 'Shared coordinates',
  объекта: 'objects',
  'Общие координаты ·': 'Shared coordinates ·',
  замечаний: 'issues',
  'Предпросмотр:': 'Preview:',
  'ед. =': 'units =',
  '· Щелчок создаёт объект · Перетаскивание меняет положение':
    '· Click to create an object · Drag to move',
  'Центр X': 'Center X',
  'Центр Y': 'Center Y',
  'Тип зоны': 'Zone type',
  'С местами': 'Seated',
  'Без мест (GA)': 'General admission (GA)',
  'Вместимость GA': 'GA capacity',
  'Преобразовать в полигон': 'Convert to polygon',
  'Название зоны': 'Zone name',
  'X зоны': 'Zone X',
  'Y зоны': 'Zone Y',
  'Ширина зоны': 'Zone width',
  'Высота зоны': 'Zone height',
  'Текст объекта': 'Object text',
  'X подписи': 'Label X',
  'Y подписи': 'Label Y',
  'Тип места': 'Seat type',
  Стул: 'Chair',
  Кресло: 'Armchair',
  'Место для коляски': 'Wheelchair bay',
  'Номер места': 'Seat number',
  'X места': 'Seat X',
  'Y места': 'Seat Y',
  Ряд: 'Row',
  'Название ряда': 'Row name',
  'Начало X': 'Start X',
  'Начало Y': 'Start Y',
  'Конец X': 'End X',
  'Конец Y': 'End Y',
  'Радиус ряда': 'Row radius',
  'Угол начала': 'Start angle',
  'Угол конца': 'End angle',
  Стол: 'Table',
  'Название стола': 'Table name',
  'X стола': 'Table X',
  'Y стола': 'Table Y',
  'Поворот (рад)': 'Rotation (rad)',
  'Радиус стола': 'Table radius',
  'Ширина стола': 'Table width',
  'Высота стола': 'Table height',
  'Файл не найден': 'File not found',
  Заблокировано: 'Locked',
  'Подложка заблокирована. Снимите блокировку, чтобы изменить положение, видимость или файл.':
    'The background is locked. Unlock it to change its position, visibility, or file.',
  'Страница PDF': 'PDF page',
  'X подложки': 'Background X',
  'Y подложки': 'Background Y',
  'Масштаб подложки': 'Background scale',
  'Поворот подложки (°)': 'Background rotation (°)',
  'Прозрачность подложки': 'Background opacity',
  Видимая: 'Visible',
  Заблокирована: 'Locked',
  'Заменить PDF': 'Replace PDF',
  'Удалить подложку': 'Delete background',
  'Удалить объект': 'Delete object',
  'Проверка схемы': 'Layout validation',
  'Номера проверяются внутри ряда или стола; для отдельных мест — внутри зоны либо этажа.':
    'Seat numbers are checked within each row or table; standalone seats are checked within their zone or floor.',
  'Публиковать с предупреждениями': 'Publish with warnings',
  Ошибка: 'Error',
  Предупреждение: 'Warning',
  Ещё: 'More',
  'Панели редактора': 'Editor panels',
  Слои: 'Layers',
  'Нет изменений': 'No changes',
  изменений: 'changes',
  'Щелчок создаёт объект': 'Click to create an object',
  'Перетаскивание меняет положение': 'Drag to move',
  'Генерация мест': 'Seat generation',
  'Мест в ряду': 'Seats in row',
  Распределение: 'Distribution',
  'Распределение мест': 'Seat distribution',
  Равномерно: 'Evenly',
  'С шагом': 'Fixed spacing',
  Шаг: 'Spacing',
  'Шаг мест': 'Seat spacing',
  'Начальный номер': 'Starting number',
  'Начальный номер ряда': 'Row starting number',
  'Нумерация обратно': 'Reverse numbering',
  'Обратная нумерация ряда': 'Reverse row numbering',
  'Пропустить позиции': 'Skip positions',
  Пропуски: 'Skipped slots',
  'Пропустить номера': 'Skip numbers',
  'Пропущенные номера': 'Skipped numbers',
  'Проходы (место:ширина)': 'Aisles (seat:width)',
  'Проходы в ряду': 'Row aisles',
  'Проходы: формат место:ширина через запятую':
    'Aisles: enter seat:width pairs separated by commas',
  'Применить места': 'Apply seats',
  'Места за столом': 'Table seats',
  'Гостей за столом': 'Guests at table',
  Сверху: 'Top',
  Справа: 'Right',
  Снизу: 'Bottom',
  Слева: 'Left',
  'Отступ стула': 'Chair offset',
  'Начальный номер стола': 'Table starting number',
  'Пропущенные места стола': 'Skipped table seats',
  'Обратная нумерация стола': 'Reverse table numbering',
  'Введите число': 'Enter a number',
  'Введите значение': 'Enter a value',
  'Введите конечное число': 'Enter a finite number',
  'Введите целое число': 'Enter a whole number',
  'PDF должен быть не больше 20 МБ': 'PDF must be no larger than 20 MB',
  'Выберите PDF-файл': 'Select a PDF file',
  'План изменился во время загрузки PDF. Повторите импорт.':
    'The layout changed while the PDF was loading. Import it again.',
  'Подложка недоступна или заблокирована':
    'The background is unavailable or locked',
  'Этаж для PDF больше не существует':
    'The floor for this PDF no longer exists',
  'PDF не содержит страниц': 'The PDF has no pages',
  'Нужно хотя бы одно место за столом': 'The table needs at least one seat',
  'Отступ стула должен быть неотрицательным':
    'Chair offset must be nonnegative',
  'Декорация имеет вырожденный полигон': 'Decoration has a degenerate polygon',
};

export function editorText(
  locale: string | undefined,
  russian: string,
): string {
  if (!locale?.toLowerCase().startsWith('en')) return russian;
  const exact = english[russian];
  if (exact) return exact;
  const vertex = /^(Вершина(?: объекта)? )([0-9]+)( [XY])$/.exec(russian);
  if (vertex)
    return `${vertex[1] === 'Вершина объекта ' ? 'Object vertex' : 'Vertex'} ${vertex[2]}${vertex[3]}`;
  const floor = /^Этаж ([0-9]+)$/.exec(russian);
  if (floor) return `Floor ${floor[1]}`;
  const seats = /^Мест (.+)$/.exec(russian);
  if (seats) return `Seats ${editorText(locale, seats[1] ?? '')}`;
  const changes = /^([0-9]+) изменений$/.exec(russian);
  if (changes) return `${changes[1]} changes`;
  const calibration = /^Калибровка: (.+) мм\/ед$/.exec(russian);
  if (calibration) return `Calibration: ${calibration[1]} mm/unit`;
  const pdfPageCount = /^(.*) · ([0-9]+) (страница|страницы)$/.exec(russian);
  if (pdfPageCount)
    return `${pdfPageCount[1]} · ${pdfPageCount[2]} ${pdfPageCount[3] === 'страница' ? 'page' : 'pages'}`;
  return russian;
}

export function translateEditorError(
  locale: string | undefined,
  message: string,
): string {
  if (!locale?.toLowerCase().startsWith('en')) return message;
  const minimum = /^Значение должно быть не меньше (.+)$/.exec(message);
  if (minimum) return `Value must be at least ${minimum[1]}`;
  const maximum = /^Значение должно быть не больше (.+)$/.exec(message);
  if (maximum) return `Value must be at most ${maximum[1]}`;
  const range = /^(.+): от ([0-9]+) до ([0-9]+)$/.exec(message);
  if (range)
    return `${editorText(locale, range[1] ?? '')}: from ${range[2]} to ${range[3]}`;
  const list = /^(.+): укажите положительные целые числа через запятую$/.exec(
    message,
  );
  if (list)
    return `${editorText(locale, list[1] ?? '')}: enter positive whole numbers separated by commas`;
  const emptyRow = /^Ряд «(.+)» не содержит мест$/.exec(message);
  if (emptyRow) return `Row “${emptyRow[1]}” has no seats`;
  const degenerateRow = /^Ряд «(.+)» имеет нулевую длину$/.exec(message);
  if (degenerateRow) return `Row “${degenerateRow[1]}” has zero length`;
  const gaSeat = /^Место (.+) привязано к GA-зоне$/.exec(message);
  if (gaSeat) return `Seat ${gaSeat[1]} is assigned to a GA zone`;
  const duplicate = /^Повтор номера (.+) в одной области$/.exec(message);
  if (duplicate) return `Duplicate seat number ${duplicate[1]} in one area`;
  const collision = /^Места (.+) и (.+) пересекаются$/.exec(message);
  if (collision) return `Seats ${collision[1]} and ${collision[2]} overlap`;
  const obstacle = /^Место (.+) находится внутри препятствия$/.exec(message);
  if (obstacle) return `Seat ${obstacle[1]} is inside an obstacle`;
  const polygon = /^Зона «(.+)» имеет вырожденный полигон$/.exec(message);
  if (polygon) return `Zone “${polygon[1]}” has a degenerate polygon`;
  return editorText(locale, message);
}
