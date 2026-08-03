import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { StoreProvider } from './store';
import { DialogProvider } from './dialogs';
import { App } from './App';

createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <StoreProvider>
      <DialogProvider>
        <App />
      </DialogProvider>
    </StoreProvider>
  </React.StrictMode>
);
