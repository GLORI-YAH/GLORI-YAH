// Annonce vocale + carte de course plein écran pensée pour un pilote en mouvement :
// gros bouton (tiers bas de l'écran), contraste maximal, confirmation par
// glissement (pas un simple appui, pour éviter les acceptations accidentelles).

/**
 * Lit à voix haute les détails d'une course, en français.
 * Le pilote n'a pas besoin de regarder l'écran pour savoir ce qui se présente.
 */
function announceRide(ride) {
  if (!('speechSynthesis' in window)) return; // navigateur trop ancien : pas bloquant, juste pas de voix

  const isDelivery = ride.service_tier === 'LIVRAISON_MOTO' || ride.service_tier === 'LIVRAISON_VOITURE';
  const nature = isDelivery ? 'Livraison' : 'Course';
  const text = `${nature} à ${ride.distance_km ? ride.distance_km + ' kilomètres' : 'proximité'}, ${ride.destination_label || ''}, ${ride.estimate_price} francs.`;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'fr-FR';
  utterance.rate = 0.95; // légèrement plus lent que la normale, pour bien comprendre en roulant
  speechSynthesis.cancel(); // annule toute annonce précédente encore en cours
  speechSynthesis.speak(utterance);
}

/**
 * Affiche une carte de course plein écran avec un bouton à glisser occupant
 * le tiers bas de l'écran. onAccept() est appelé si le pilote va au bout du
 * glissement ; onRefuse() s'il ferme la carte.
 */
function showRideCard(ride, onAccept, onRefuse) {
  announceRide(ride);

  const overlay = document.createElement('div');
  overlay.id = 'rideCardOverlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: #FFFFFF; z-index: 10000;
    display: flex; flex-direction: column; font-family: -apple-system, sans-serif;
  `;

  overlay.innerHTML = `
    <div style="flex: 1; display:flex; flex-direction:column; justify-content:center; align-items:center; padding: 24px; text-align:center;">
      <div style="font-size: 1.1rem; color:#6b7a85; font-weight:600;">${(ride.service_tier === 'LIVRAISON_MOTO' || ride.service_tier === 'LIVRAISON_VOITURE') ? 'NOUVELLE LIVRAISON' : 'NOUVELLE COURSE'}</div>
      <div style="font-size: 2.4rem; font-weight: 800; color:#2C3E50; margin: 12px 0;">${ride.destination_label || 'Destination'}</div>
      ${ride.package_description ? `<div style="font-size: 0.95rem; color:#6b7a85; margin-bottom:8px;">📦 ${ride.package_description}</div>` : ''}
      <div style="font-size: 1.6rem; color:#29B6F6; font-weight:700;">${ride.distance_km ? ride.distance_km + ' km' : ''}</div>
      <div style="font-size: 2.8rem; font-weight: 900; color:#A91D22; margin-top: 16px;">${ride.estimate_price} FCFA</div>
    </div>

    <div style="height: 33vh; position: relative; background: #f4f6f8; border-top: 3px solid #d7dee3;">
      <div id="rideSwipeTrack" style="position:absolute; inset:16px; background:#2C3E50; border-radius:20px; display:flex; align-items:center; overflow:hidden;">
        <div id="rideSwipeHandle" style="width:88px; height:88px; background:#A91D22; border-radius:16px; margin-left:8px; display:flex; align-items:center; justify-content:center; touch-action:none; cursor:grab;">
          <span style="color:white; font-size:2.2rem;">➜</span>
        </div>
        <span style="color:white; font-size:1.3rem; font-weight:700; margin-left: 20px;">GLISSEZ POUR ACCEPTER</span>
      </div>
    </div>

    <button id="rideRefuseBtn" style="border:none; background:none; color:#6b7a85; padding:16px; font-size:1rem;">Refuser</button>
  `;

  document.body.appendChild(overlay);

  // Logique de glissement (souris ET tactile)
  const handle = overlay.querySelector('#rideSwipeHandle');
  const track = overlay.querySelector('#rideSwipeTrack');
  let dragging = false;
  let startX = 0;

  function onDragStart(clientX) {
    dragging = true;
    startX = clientX - handle.offsetLeft;
    handle.style.cursor = 'grabbing';
  }

  function onDragMove(clientX) {
    if (!dragging) return;
    const maxX = track.clientWidth - handle.clientWidth - 16;
    let newX = clientX - startX;
    newX = Math.max(8, Math.min(newX, maxX));
    handle.style.marginLeft = newX + 'px';

    if (newX >= maxX - 4) {
      dragging = false;
      overlay.remove();
      onAccept();
    }
  }

  function onDragEnd() {
    if (!dragging) return;
    dragging = false;
    handle.style.marginLeft = '8px'; // revient au point de départ si pas allé au bout
    handle.style.cursor = 'grab';
  }

  handle.addEventListener('mousedown', (e) => onDragStart(e.clientX));
  document.addEventListener('mousemove', (e) => onDragMove(e.clientX));
  document.addEventListener('mouseup', onDragEnd);

  handle.addEventListener('touchstart', (e) => onDragStart(e.touches[0].clientX));
  document.addEventListener('touchmove', (e) => onDragMove(e.touches[0].clientX));
  document.addEventListener('touchend', onDragEnd);

  overlay.querySelector('#rideRefuseBtn').addEventListener('click', () => {
    speechSynthesis.cancel();
    overlay.remove();
    onRefuse();
  });
}
