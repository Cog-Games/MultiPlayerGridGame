import { GameApplication } from './src/core/GameApplication.js';

const app = new GameApplication(document.getElementById('app'));

document.addEventListener('DOMContentLoaded', () => {
  app.start().catch(error => {
    console.error('Failed to start:', error);
    document.getElementById('app').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;">
        <div style="text-align:center;color:#aaa;">
          <h2>Error</h2>
          <p>${error.message}</p>
          <button onclick="window.location.reload()" style="padding:10px 20px;font-size:16px;">Retry</button>
        </div>
      </div>
    `;
  });
});
