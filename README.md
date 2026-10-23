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
