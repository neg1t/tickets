export type HoldNoticeProps = Readonly<{
  locale: string;
}>;

export function HoldNotice({ locale }: HoldNoticeProps) {
  const english = locale.toLowerCase().startsWith('en');
  return (
    <div className="tp-hold-notice">
      {english
        ? 'Your selected tickets are temporarily reserved. Complete the purchase before the timer ends; availability is not guaranteed after that.'
        : 'Мы временно зарезервировали выбранные билеты. Успейте завершить покупку до конца таймера — после его окончания наличие мест не гарантируется.'}
    </div>
  );
}
