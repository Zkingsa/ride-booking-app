const driverRides = document.getElementById('driver-rides');

async function loadPendingRides() {
  try {
    const response = await fetch('/api/rides');
    const rides = await response.json();
    const activeRides = rides.filter(r => r.status !== 'completed');
    
    if (activeRides.length === 0) {
      driverRides.innerHTML = '<p class="no-rides">No rides available right now.</p>';
      return;
    }
    
    driverRides.innerHTML = '';
    activeRides.forEach(ride => {
      const card = document.createElement('div');
      card.className = 'ride-card';
      card.innerHTML = `
        <div class="coords">
          <strong>Pickup:</strong> ${ride.pickup.lat.toFixed(4)}, ${ride.pickup.lng.toFixed(4)}<br>
          <strong>Dropoff:</strong> ${ride.dropoff.lat.toFixed(4)}, ${ride.dropoff.lng.toFixed(4)}
        </div>
        <span class="status ${ride.status}">${ride.status}</span>
        ${ride.status === 'pending' ? `<button class="accept-btn" onclick="updateRide('${ride._id}', 'accepted')">Accept</button>` : ''}
        ${ride.status === 'accepted' ? `<button class="complete-btn" onclick="updateRide('${ride._id}', 'completed')">Complete</button>` : ''}
      `;
      driverRides.appendChild(card);
    });
  } catch (err) {
    console.error('Error loading rides:', err);
  }
}

async function updateRide(id, status) {
  try {
    await fetch(`/api/rides/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    loadPendingRides();
  } catch (err) {
    console.error('Error updating ride:', err);
  }
}

loadPendingRides();
setInterval(loadPendingRides, 5000);