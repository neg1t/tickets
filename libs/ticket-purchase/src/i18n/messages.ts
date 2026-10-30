import type { PurchaseStep } from '../lib/TicketPurchaseProvider.js';

export type PurchaseMessages = Readonly<{
  checkoutTitle: string;
  steps: Readonly<Record<PurchaseStep, string>>;
  backToEvent: string;
  eventDetails: string;
  loading: string;
  hallMap: string;
}>;

const messages: Readonly<Record<'ru' | 'en', PurchaseMessages>> = {
  ru: {
    checkoutTitle: 'Оформление заказа',
    steps: {
      selection: 'Выбор билета',
      contacts: 'Контактные данные',
      payment: 'Оплата',
      success: 'Подтверждение',
    },
    backToEvent: 'Назад к мероприятию',
    eventDetails: 'Подробнее о событии',
    loading: 'Загрузка покупки…',
    hallMap: 'Схема зала',
  },
  en: {
    checkoutTitle: 'Checkout',
    steps: {
      selection: 'Select tickets',
      contacts: 'Contact details',
      payment: 'Payment',
      success: 'Confirmation',
    },
    backToEvent: 'Back to event',
    eventDetails: 'Event details',
    loading: 'Loading purchase…',
    hallMap: 'Hall map',
  },
};

export function getPurchaseMessages(locale: string): PurchaseMessages {
  return locale.toLowerCase().startsWith('en') ? messages.en : messages.ru;
}

