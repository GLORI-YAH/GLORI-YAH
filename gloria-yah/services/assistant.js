// Assistant IA GLORI-YAH — passager/chauffeur/admin.
//
// GARDE-FOUS NON NÉGOCIABLES (posés dès le concept initial du produit) :
// - L'IA n'a JAMAIS le dernier mot sur : blocage de compte définitif, litige
//   impliquant la sécurité physique, changement de tarif. Ces sujets sont
//   systématiquement redirigés vers un humain, jamais tranchés par l'assistant.
// - Transparence obligatoire : l'utilisateur sait qu'il parle à une IA.
// - Aucune suggestion de majoration déguisée — l'IA ne peut jamais recommander
//   un prix plus élevé selon le trafic/la météo/quoi que ce soit.
//
// ⚠️ Nécessite une clé API Anthropic (https://console.anthropic.com).

const SENSITIVE_KEYWORDS = [
  'accident', 'agress', 'viol', 'vol ', 'voleur', 'armé', 'arme', 'blessé', 'blessee',
  'urgence', 'police', 'danger', 'peur', 'menace', 'harcèle', 'harcele',
];

/** Détecte si le message touche à un sujet qui doit être escaladé à un humain, jamais tranché par l'IA. */
function requiresHumanEscalation(message) {
  const lower = message.toLowerCase();
  return SENSITIVE_KEYWORDS.some((kw) => lower.includes(kw));
}

function buildSystemPrompt(role, context) {
  const base = `Tu es l'assistant GLORI-YAH, une plateforme de VTC en Afrique de l'Ouest (Bénin, Togo, Côte d'Ivoire, Sénégal...).
Tu réponds en français, de façon brève et directe (2-4 phrases maximum sauf si on te demande un détail).

RÈGLES STRICTES, JAMAIS NÉGOCIABLES :
1. Tu ne prends JAMAIS la décision finale sur : un remboursement, un blocage de compte, un litige de sécurité, ou un changement de tarif. Pour ces sujets, tu expliques que tu transmets à un membre de l'équipe et que quelqu'un va reprendre la conversation.
2. Tu ne suggères JAMAIS d'augmenter un prix pour cause de trafic, météo, ou heure de pointe — GLORI-YAH applique une politique "Zéro Majoration" stricte.
3. Si on te demande explicitement si tu es une IA, réponds toujours honnêtement que oui.
4. Si le sujet touche à la sécurité physique (accident, agression, urgence), ne tente PAS de gérer ça toi-même — dis immédiatement que tu transmets en priorité à un humain et invite la personne à contacter les secours locaux si c'est une urgence.`;

  const roleContext = {
    PASSAGER: "Tu aides un passager : expliquer un prix, aider à réserver, répondre sur le fonctionnement du Prix Plafond Garanti (le prix final est toujours le plus bas entre l'estimation et le compteur réel).",
    CHAUFFEUR: "Tu aides un pilote (chauffeur) : questions sur le wallet, la commission, les zones de forte demande, comment déclarer un véhicule.",
    ADMIN: "Tu aides un membre de l'équipe GLORI-YAH à consulter des statistiques ou des situations opérationnelles.",
  };

  return `${base}\n\nContexte : ${roleContext[role] || roleContext.PASSAGER}${context ? '\n\nInformations disponibles sur la situation actuelle : ' + context : ''}`;
}

/**
 * Envoie un message à l'assistant et renvoie sa réponse.
 * escalated=true signifie que le sujet a été détecté comme sensible et que
 * la réponse invite explicitement à contacter un humain / les secours.
 */
async function chatWithAssistant(message, { role = 'PASSAGER', context = null } = {}) {
  if (requiresHumanEscalation(message)) {
    return {
      reply: "Je transmets immédiatement ta demande à un membre de l'équipe GLORI-YAH — quelqu'un va te répondre en priorité. Si c'est une urgence en ce moment même, contacte directement les secours locaux ou utilise le bouton SOS de l'application.",
      escalated: true,
      is_ai: true,
    };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      reply: "L'assistant IA n'est pas encore configuré sur ce serveur (clé API manquante). Un membre de l'équipe peut t'aider directement en attendant.",
      escalated: false,
      is_ai: true,
      note: 'ANTHROPIC_API_KEY manquante',
    };
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: buildSystemPrompt(role, context),
      messages: [{ role: 'user', content: message }],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Erreur API Anthropic ${response.status} : ${text}`);
  }

  const data = await response.json();
  const reply = data.content?.find((block) => block.type === 'text')?.text
    || "Désolé, je n'ai pas pu formuler de réponse — réessaie ou contacte le support.";

  return { reply, escalated: false, is_ai: true };
}

module.exports = { chatWithAssistant, requiresHumanEscalation };
