(() => {
  const statusEl = document.getElementById('sse-status');
  const participantsCountEl = document.getElementById('screen-participants-count');
  const productsCountEl = document.getElementById('screen-products-count');
  const emptyEl = document.getElementById('screen-empty');
  const listEl = document.getElementById('screen-products-list');

  function setStatus(text, tone) {
    statusEl.textContent = text;
    statusEl.className = `badge badge-${tone}`;
  }

  function renderState(state) {
    const products = Array.isArray(state.products) ? state.products : [];
    const participantsCount =
      typeof state.participantsCount === 'number' ? state.participantsCount : 0;

    participantsCountEl.textContent = String(participantsCount);
    productsCountEl.textContent =
      products.length === 1 ? '1 producto' : `${products.length} productos`;

    emptyEl.classList.toggle('hidden', products.length > 0);
    listEl.innerHTML = '';

    products.forEach((product, index) => {
      const li = document.createElement('li');
      li.className = 'product-card screen-card';
      if (index === 0 && product.votesCount > 0) {
        li.classList.add('is-leader');
      }

      const rank = document.createElement('div');
      rank.className = 'product-rank';
      rank.textContent = `#${index + 1}`;

      const img = document.createElement('img');
      img.className = 'product-thumb';
      img.src = product.thumbnail;
      img.alt = product.title;
      img.loading = 'lazy';

      const info = document.createElement('div');
      info.className = 'product-info';

      const title = document.createElement('h3');
      title.className = 'product-title';
      title.textContent = product.title;

      const meta = document.createElement('p');
      meta.className = 'product-meta';
      meta.textContent = `$${product.price} · Propuesto por ${product.proposedBy}`;

      info.append(title, meta);

      const votes = document.createElement('div');
      votes.className = 'screen-votes';
      votes.textContent =
        product.votesCount === 1 ? '1 voto' : `${product.votesCount} votos`;

      li.append(rank, img, info, votes);
      listEl.appendChild(li);
    });
  }

  // Conexión unidireccional Server-Sent Events (SSE)
  const eventSource = new EventSource('/events');

  eventSource.addEventListener('open', () => {
    setStatus('En vivo (SSE)', 'success');
  });

  // El servidor emite eventos con nombre "state"
  eventSource.addEventListener('state', (event) => {
    try {
      const data = JSON.parse(event.data);
      setStatus('En vivo (SSE)', 'success');
      renderState(data);
    } catch {
      // Ignorar evento malformado
    }
  });

  eventSource.addEventListener('error', () => {
    setStatus('Reconectando...', 'warning');
  });
})();
