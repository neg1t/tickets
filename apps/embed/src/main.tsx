import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { App } from './app/App';
import '@hall-platform/design-tokens/styles.css';
import '@hall-platform/seat-view/styles.css';
import './styles.css';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
