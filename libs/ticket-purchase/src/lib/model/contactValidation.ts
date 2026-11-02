import { buyerContactSchema, type BuyerContact } from '@hall-platform/api-contracts';

export type ContactField = keyof BuyerContact;
export type ContactFieldErrors = Partial<Record<ContactField, string>>;

const fieldOrder: readonly ContactField[] = ['firstName', 'lastName', 'phone', 'email'];

export function normalizeContactDraft(contact: BuyerContact): BuyerContact {
  return {
    firstName: contact.firstName.trim(),
    lastName: contact.lastName.trim(),
    phone: contact.phone.trim(),
    email: contact.email.trim(),
  };
}

export function validateContactDraft(contact: BuyerContact, locale = 'ru-RU'): ContactFieldErrors {
  const parsed = buyerContactSchema.safeParse(normalizeContactDraft(contact));
  if (parsed.success) return {};

  const english = locale.toLowerCase().startsWith('en');
  const errors: ContactFieldErrors = {};
  const labels: Record<ContactField, string> = english
    ? {
        firstName: 'Enter your first name.',
        lastName: 'Enter your last name.',
        phone: 'Enter a valid phone number with country code.',
        email: 'Enter a valid email address.',
      }
    : {
        firstName: 'Укажите имя.',
        lastName: 'Укажите фамилию.',
        phone: 'Укажите корректный номер с кодом страны.',
        email: 'Укажите корректный адрес электронной почты.',
      };

  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && fieldOrder.includes(field as ContactField)) {
      const key = field as ContactField;
      errors[key] ??= labels[key];
    }
  }
  return errors;
}

export function contactFieldErrorsFromApi(
  fieldErrors: readonly { readonly path: readonly (string | number)[]; readonly message: string }[] | undefined,
): ContactFieldErrors {
  const errors: ContactFieldErrors = {};
  if (!fieldErrors) return errors;
  for (const issue of fieldErrors) {
    const path = issue.path.at(-1);
    if (typeof path === 'string' && fieldOrder.includes(path as ContactField)) {
      errors[path as ContactField] ??= issue.message;
    }
  }
  return errors;
}
