import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { StoreProvider } from './store';
import { DialogProvider } from './dialogs';
import { ViewerProvider } from './components/Viewer';
import { App } from './App';

createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <StoreProvider>
      <DialogProvider>
        <ViewerProvider>
          <App />
        </ViewerProvider>
      </DialogProvider>
    </StoreProvider>
  </React.StrictMode>
);
