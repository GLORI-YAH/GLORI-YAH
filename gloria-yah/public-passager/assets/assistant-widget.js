// Petit widget de chat flottant — bouton en bas à gauche, ouvre un panneau
// simple. Réutilisable sur les 3 pages (passager/chauffeur/admin).

function initAssistantWidget() {
  const btn = document.createElement('button');
  btn.textContent = '💬';
  btn.title = 'Assistant GLORI-YAH';
  btn.style.cssText = `
    position: fixed; bottom: 20px; left: 20px; z-index: 9998;
    width: 52px; height: 52px; border-radius: 50%; border: none;
    background: #1A2733; color: white; font-size: 1.4rem; cursor: pointer;
    box-shadow: 0 3px 10px rgba(0,0,0,0.25);
  `;

  const panel = document.createElement('div');
  panel.style.cssText = `
    position: fixed; bottom: 84px; left: 20px; z-index: 9998;
    width: 300px; max-width: calc(100vw - 40px); height: 400px;
    background: white; border-radius: 16px; box-shadow: 0 6px 20px rgba(0,0,0,0.2);
    display: none; flex-direction: column; overflow: hidden; font-family: -apple-system, sans-serif;
  `;
  panel.innerHTML = `
    <div style="background:#2C3E50;color:white;padding:12px 16px;font-weight:700;">
      Assistant GLORI-YAH
      <span style="float:right;font-size:0.7rem;font-weight:400;opacity:0.8;">Je suis une IA</span>
    </div>
    <div id="assistantMessages" style="flex:1;overflow-y:auto;padding:12px;font-size:0.88rem;"></div>
    <div style="display:flex;border-top:1px solid #eee;">
      <input id="assistantInput" placeholder="Écris ta question..." style="flex:1;border:none;padding:12px;font-size:0.88rem;">
      <button id="assistantSend" style="border:none;background:#1A2733;color:white;padding:0 16px;font-weight:700;">Envoyer</button>
    </div>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  btn.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  });

  function addMessage(text, fromUser) {
    const msgs = document.getElementById('assistantMessages');
    const bubble = document.createElement('div');
    bubble.style.cssText = `
      margin-bottom: 10px; padding: 8px 12px; border-radius: 12px; max-width: 85%;
      ${fromUser ? 'background:#1A2733;color:white;margin-left:auto;' : 'background:#f4f6f8;color:#2C3E50;'}
    `;
    bubble.textContent = text;
    msgs.appendChild(bubble);
    msgs.scrollTop = msgs.scrollHeight;
  }

  addMessage("Bonjour ! Je suis l'assistant GLORI-YAH — je peux t'aider sur le prix, ta course, ou ton compte. Pour tout sujet de sécurité, je transmets directement à un humain.", false);

  async function envoyerMessage() {
    const input = document.getElementById('assistantInput');
    const text = input.value.trim();
    if (!text) return;
    addMessage(text, true);
    input.value = '';

    try {
      const result = await apiFetch('/assistant/chat', {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      });
      addMessage(result.reply, false);
    } catch (err) {
      addMessage("Désolé, l'assistant est indisponible pour le moment (" + err.message + ").", false);
    }
  }

  document.getElementById('assistantSend').addEventListener('click', envoyerMessage);
  document.getElementById('assistantInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') envoyerMessage();
  });
}

document.addEventListener('DOMContentLoaded', initAssistantWidget);
