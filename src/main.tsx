import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { isTauri } from './lib/tauri';
import { DesktopGate } from './components/DesktopGate';
import './index.css';

// Dockman drives the Docker / Podman CLIs on the local machine, which only
// the desktop shell can do. In a plain browser (the project website, a dev
// server) the gate explains that and links to the installers.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isTauri() ? <RouterProvider router={router} /> : <DesktopGate />}
  </React.StrictMode>,
);
