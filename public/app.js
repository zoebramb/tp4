(() => {
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${wsProtocol}//${location.host}`);

  // Exponemos el socket en window para facilitar pruebas desde la consola del navegador
  window.ws = ws;

  let myName = null;
  let products = [];
  let participants = [];
  let pendingProposals = 0;

  // Referencias al DOM
  const connectionStatusEl = document.getElementById('connection-status');
  const userPillEl = document.getElementById('user-pill');

  const joinViewEl = document.getElementById('join-view');
  const joinFormEl = document.getElementById('join-form');
  const nameInputEl = document.getElementById('name-input');
  const joinErrorEl = document.getElementById('join-error');

  const roomViewEl = document.getElementById('room-view');
  const globalErrorEl = document.getElementById('global-error');
  const globalErrorTextEl = document.getElementById('global-error-text');
  const dismissErrorBtn = document.getElementById('dismiss-error-btn');

  const participantsCountEl = document.getElementById('participants-count');
  const participantsListEl = document.getElementById('participants-list');

  const proposeFormEl = document.getElementById('propose-form');
  const proposeInputEl = document.getElementById('propose-input');
  const proposeLoadingEl = document.getElementById('propose-loading');
  const proposeResultEl = document.getElementById('propose-result');

  const productsCountEl = document.getElementById('products-count');
  const emptyListEl = document.getElementById('empty-list');
  const productsListEl = document.getElementById('products-list');

  const ERROR_REASON_LABELS = {
    NOT_FOUND: 'Producto inexistente',
    TIMEOUT: 'Tiempo de espera agotado',
    ALREADY_IN_LIST: 'Ya en la lista',
    CATALOG_ERROR: 'Error del catálogo',
  };

  function setConnectionStatus(text, tone) {
    connectionStatusEl.textContent = text;
    connectionStatusEl.className = `badge badge-${tone}`;
  }

  function showError(message) {
    if (!myName) {
      joinErrorEl.textContent = message;
      joinErrorEl.classList.remove('hidden');
      return;
    }
    globalErrorTextEl.textContent = message;
    globalErrorEl.classList.remove('hidden');
  }

  function clearErrors() {
    joinErrorEl.classList.add('hidden');
    joinErrorEl.textContent = '';
    globalErrorEl.classList.add('hidden');
    globalErrorTextEl.textContent = '';
  }

  function updateProposeLoading() {
    if (pendingProposals > 0) {
      proposeLoadingEl.classList.remove('hidden');
    } else {
      proposeLoadingEl.classList.add('hidden');
    }
  }

  function sendMessage(payload) {
    if (ws.readyState !== WebSocket.OPEN) {
      showError('No hay conexión activa con el servidor.');
      return false;
    }
    ws.send(JSON.stringify(payload));
    return true;
  }

  function renderParticipants() {
    participantsCountEl.textContent = String(participants.length);
    participantsListEl.innerHTML = '';

    for (const name of participants) {
      const li = document.createElement('li');
      li.className = 'participant-item';
      if (name === myName) {
        li.classList.add('is-me');
        li.textContent = `${name} (vos)`;
      } else {
        li.textContent = name;
      }
      participantsListEl.appendChild(li);
    }
  }

  function renderProducts() {
    const count = products.length;
    productsCountEl.textContent = count === 1 ? '1 producto' : `${count} productos`;
    emptyListEl.classList.toggle('hidden', count > 0);
    productsListEl.innerHTML = '';

    products.forEach((product, index) => {
      const li = document.createElement('li');
      li.className = 'product-card';

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
      meta.textContent = `ID ${product.id} · $${product.price} · Propuesto por ${product.proposedBy}`;

      const votersLine = document.createElement('p');
      votersLine.className = 'product-voters';
      if (product.voters.length > 0) {
        votersLine.textContent = `Votaron: ${product.voters.join(', ')}`;
      } else {
        votersLine.textContent = 'Sin votos todavía';
      }

      info.append(title, meta, votersLine);

      const actions = document.createElement('div');
      actions.className = 'product-actions';

      const votesBadge = document.createElement('span');
      votesBadge.className = 'votes-pill';
      votesBadge.textContent =
        product.votesCount === 1 ? '1 voto' : `${product.votesCount} votos`;

      const hasVoted = myName !== null && product.voters.includes(myName);
      const voteBtn = document.createElement('button');
      voteBtn.type = 'button';
      voteBtn.className = hasVoted ? 'btn btn-voted btn-sm' : 'btn btn-primary btn-sm';
      voteBtn.textContent = hasVoted ? 'Quitar voto' : 'Votar';
      voteBtn.addEventListener('click', () => {
        clearErrors();
        sendMessage({
          type: hasVoted ? 'UNVOTE' : 'VOTE',
          productId: product.id,
        });
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn-danger btn-sm';
      removeBtn.textContent = 'Quitar';
      removeBtn.addEventListener('click', () => {
        clearErrors();
        sendMessage({
          type: 'REMOVE',
          productId: product.id,
        });
      });

      actions.append(votesBadge, voteBtn, removeBtn);
      li.append(rank, img, info, actions);
      productsListEl.appendChild(li);
    });
  }

  function renderProposeResult(addedIds, errors) {
    proposeResultEl.innerHTML = '';
    proposeResultEl.classList.remove('hidden');

    if (addedIds.length > 0) {
      const okBox = document.createElement('div');
      okBox.className = 'alert alert-success';
      okBox.textContent = `Agregados correctamente: ID ${addedIds.join(', ')}`;
      proposeResultEl.appendChild(okBox);
    }

    if (errors.length > 0) {
      const errBox = document.createElement('div');
      errBox.className = 'alert alert-warning';

      const heading = document.createElement('strong');
      heading.textContent = 'No se pudieron agregar los siguientes productos:';
      errBox.appendChild(heading);

      const list = document.createElement('ul');
      list.className = 'error-items-list';

      for (const item of errors) {
        const li = document.createElement('li');
        const label = ERROR_REASON_LABELS[item.reason] || item.reason;
        li.textContent = `ID ${item.id} (${label}): ${item.detail}`;
        list.appendChild(li);
      }

      errBox.appendChild(list);
      proposeResultEl.appendChild(errBox);
    }
  }

  // Eventos del WebSocket
  ws.addEventListener('open', () => {
    setConnectionStatus('Conectado', 'success');
  });

  ws.addEventListener('close', () => {
    setConnectionStatus('Desconectado', 'danger');
    pendingProposals = 0;
    updateProposeLoading();
    showError('Se perdió la conexión con el servidor. Recargá la página para volver a entrar.');
  });

  ws.addEventListener('error', () => {
    setConnectionStatus('Error de conexión', 'danger');
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'STATE_SYNC':
        myName = msg.yourName;
        products = msg.products;
        participants = msg.participants;
        clearErrors();

        userPillEl.textContent = `Participante: ${myName}`;
        userPillEl.classList.remove('hidden');
        joinViewEl.classList.add('hidden');
        roomViewEl.classList.remove('hidden');

        renderParticipants();
        renderProducts();
        break;

      case 'PARTICIPANTS_UPDATED':
        participants = msg.participants;
        renderParticipants();
        break;

      case 'LIST_UPDATED':
        products = msg.products;
        renderProducts();
        break;

      case 'PROPOSE_RESULT':
        pendingProposals = Math.max(0, pendingProposals - 1);
        updateProposeLoading();
        renderProposeResult(msg.addedIds || [], msg.errors || []);
        break;

      case 'ERROR':
        showError(msg.message || 'Ocurrió un error.');
        break;
    }
  });

  // Eventos de formularios
  joinFormEl.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors();
    sendMessage({
      type: 'JOIN',
      name: nameInputEl.value,
    });
  });

  proposeFormEl.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors();

    const raw = proposeInputEl.value.trim();
    const tokens = raw ? raw.split(/[\s,;]+/).filter(Boolean) : [];
    const productIds = tokens.map((token) => Number(token));

    const willQueryCatalog =
      productIds.length >= 1 &&
      productIds.length <= 10 &&
      productIds.every((id) => Number.isInteger(id) && id > 0);

    if (sendMessage({ type: 'PROPOSE', productIds })) {
      if (willQueryCatalog) {
        pendingProposals += 1;
        updateProposeLoading();
        proposeInputEl.value = '';
      }
    }
  });

  dismissErrorBtn.addEventListener('click', () => {
    clearErrors();
  });
})();
