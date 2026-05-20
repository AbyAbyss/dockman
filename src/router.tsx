import { createHashRouter } from 'react-router-dom';
import App from './App';
import Dashboard from './pages/Dashboard';
import Containers from './pages/Containers';
import Images from './pages/Images';
import Volumes from './pages/Volumes';
import Networks from './pages/Networks';
import Builds from './pages/Builds';
import Binaries from './pages/Binaries';
import Settings from './pages/Settings';

// Hash routing — robust for a Tauri desktop app where there is no server to
// resolve deep paths on reload.
export const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'containers', element: <Containers /> },
      { path: 'images', element: <Images /> },
      { path: 'volumes', element: <Volumes /> },
      { path: 'networks', element: <Networks /> },
      { path: 'builds', element: <Builds /> },
      { path: 'binaries', element: <Binaries /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
]);
