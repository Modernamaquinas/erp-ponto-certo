import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { ProvedorAvisos } from './componentes/ui.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ProvedorAvisos>
      <App />
    </ProvedorAvisos>
  </StrictMode>,
);
