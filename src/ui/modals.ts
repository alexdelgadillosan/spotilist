export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type ConfirmOpts = {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
};

export function confirmModal(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${escapeHtml(opts.title)}</h3>
        <p class="muted">${opts.body}</p>
        <div class="modal-actions">
          <button type="button" class="ghost-btn" data-act="cancel">Cancel</button>
          <button type="button" class="btn ${opts.danger ? 'danger' : 'primary'}" data-act="ok">
            ${escapeHtml(opts.confirmLabel || 'Confirm')}
          </button>
        </div>
      </div>
    `;
    const close = (ok: boolean) => {
      overlay.remove();
      resolve(ok);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
    overlay.querySelector('[data-act="cancel"]')?.addEventListener('click', () => close(false));
    overlay.querySelector('[data-act="ok"]')?.addEventListener('click', () => close(true));
    document.body.appendChild(overlay);
    (overlay.querySelector('[data-act="ok"]') as HTMLButtonElement)?.focus();
  });
}

export type PromptPlaylistOpts = {
  title: string;
  playlists: { id: string; name: string }[];
  excludeIds?: string[];
};

export function pickPlaylistModal(opts: PromptPlaylistOpts): Promise<string | null> {
  return new Promise((resolve) => {
    const exclude = new Set(opts.excludeIds || []);
    const list = opts.playlists.filter((p) => !exclude.has(p.id));
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal wide" role="dialog" aria-modal="true">
        <h3>${escapeHtml(opts.title)}</h3>
        <input type="search" class="field" id="dest-search" placeholder="Search playlists…" autocomplete="off" />
        <div class="dest-list" id="dest-list">
          ${
            list.length
              ? list
                  .map(
                    (p) =>
                      `<button type="button" class="dest-item" data-id="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button>`
                  )
                  .join('')
              : '<p class="muted">No playlists available.</p>'
          }
        </div>
        <div class="modal-actions">
          <button type="button" class="ghost-btn" data-act="cancel">Cancel</button>
        </div>
      </div>
    `;
    const close = (id: string | null) => {
      overlay.remove();
      resolve(id);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    overlay.querySelector('[data-act="cancel"]')?.addEventListener('click', () => close(null));
    const listEl = overlay.querySelector('#dest-list')!;
    listEl.querySelectorAll<HTMLButtonElement>('.dest-item').forEach((btn) => {
      btn.addEventListener('click', () => close(btn.dataset.id || null));
    });
    const search = overlay.querySelector('#dest-search') as HTMLInputElement;
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      listEl.querySelectorAll<HTMLButtonElement>('.dest-item').forEach((btn) => {
        const name = btn.textContent?.toLowerCase() || '';
        btn.hidden = q ? !name.includes(q) : false;
      });
    });
    document.body.appendChild(overlay);
    search.focus();
  });
}

export type NewPlaylistOpts = {
  title: string;
  defaultName: string;
  count: number;
};

export function newPlaylistModal(
  opts: NewPlaylistOpts
): Promise<{ name: string; isPublic: boolean } | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${escapeHtml(opts.title)}</h3>
        <p class="muted">Will add ${opts.count} track${opts.count === 1 ? '' : 's'}.</p>
        <label class="field-label">Name
          <input type="text" class="field" id="pl-name" value="${escapeHtml(opts.defaultName)}" />
        </label>
        <label class="check-row">
          <input type="checkbox" id="pl-public" />
          Public on my profile
        </label>
        <div class="modal-actions">
          <button type="button" class="ghost-btn" data-act="cancel">Cancel</button>
          <button type="button" class="btn primary" data-act="ok">Create</button>
        </div>
      </div>
    `;
    const close = (v: { name: string; isPublic: boolean } | null) => {
      overlay.remove();
      resolve(v);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    overlay.querySelector('[data-act="cancel"]')?.addEventListener('click', () => close(null));
    overlay.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      const name = (overlay.querySelector('#pl-name') as HTMLInputElement).value.trim();
      if (!name) return;
      const isPublic = (overlay.querySelector('#pl-public') as HTMLInputElement).checked;
      close({ name, isPublic });
    });
    document.body.appendChild(overlay);
    (overlay.querySelector('#pl-name') as HTMLInputElement).focus();
  });
}

export type MergeModalOpts = {
  sourceNames: string[];
  totalRaw: number;
  uniqueCount: number;
  duplicateCount: number;
  playlists: { id: string; name: string }[];
};

export function mergeModal(
  opts: MergeModalOpts
): Promise<{ mode: 'new' | 'existing'; name?: string; playlistId?: string; isPublic?: boolean } | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal wide" role="dialog" aria-modal="true">
        <h3>Merge playlists</h3>
        <p class="muted">
          ${escapeHtml(opts.sourceNames.join(' + '))}<br/>
          ${opts.totalRaw} tracks → ${opts.uniqueCount} unique
          ${opts.duplicateCount ? ` (${opts.duplicateCount} duplicates removed)` : ''}
        </p>
        <fieldset class="merge-mode">
          <label><input type="radio" name="merge-mode" value="new" checked /> New playlist</label>
          <label><input type="radio" name="merge-mode" value="existing" /> Existing playlist</label>
        </fieldset>
        <div id="merge-new">
          <label class="field-label">Name
            <input type="text" class="field" id="merge-name" value="Merged playlist" />
          </label>
          <label class="check-row">
            <input type="checkbox" id="merge-public" />
            Public on my profile
          </label>
        </div>
        <div id="merge-existing" hidden>
          <input type="search" class="field" id="merge-search" placeholder="Search destination…" />
          <div class="dest-list" id="merge-dest">
            ${opts.playlists
              .map(
                (p) =>
                  `<button type="button" class="dest-item" data-id="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button>`
              )
              .join('')}
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="ghost-btn" data-act="cancel">Cancel</button>
          <button type="button" class="btn primary" data-act="ok">Merge</button>
        </div>
      </div>
    `;

    let pickedId: string | null = null;
    const newBlock = overlay.querySelector('#merge-new') as HTMLElement;
    const existingBlock = overlay.querySelector('#merge-existing') as HTMLElement;

    overlay.querySelectorAll<HTMLInputElement>('input[name="merge-mode"]').forEach((r) => {
      r.addEventListener('change', () => {
        const mode = (overlay.querySelector('input[name="merge-mode"]:checked') as HTMLInputElement)
          .value;
        newBlock.hidden = mode !== 'new';
        existingBlock.hidden = mode !== 'existing';
      });
    });

    const destList = overlay.querySelector('#merge-dest')!;
    destList.querySelectorAll<HTMLButtonElement>('.dest-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        destList.querySelectorAll('.dest-item').forEach((el) => el.classList.remove('active'));
        btn.classList.add('active');
        pickedId = btn.dataset.id || null;
      });
    });
    (overlay.querySelector('#merge-search') as HTMLInputElement)?.addEventListener('input', (e) => {
      const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
      destList.querySelectorAll<HTMLButtonElement>('.dest-item').forEach((btn) => {
        const name = btn.textContent?.toLowerCase() || '';
        btn.hidden = q ? !name.includes(q) : false;
      });
    });

    const close = (
      v: { mode: 'new' | 'existing'; name?: string; playlistId?: string; isPublic?: boolean } | null
    ) => {
      overlay.remove();
      resolve(v);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    overlay.querySelector('[data-act="cancel"]')?.addEventListener('click', () => close(null));
    overlay.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      const mode = (overlay.querySelector('input[name="merge-mode"]:checked') as HTMLInputElement)
        .value as 'new' | 'existing';
      if (mode === 'new') {
        const name = (overlay.querySelector('#merge-name') as HTMLInputElement).value.trim();
        if (!name) return;
        const isPublic = (overlay.querySelector('#merge-public') as HTMLInputElement).checked;
        close({ mode: 'new', name, isPublic });
      } else {
        if (!pickedId) return;
        close({ mode: 'existing', playlistId: pickedId });
      }
    });
    document.body.appendChild(overlay);
  });
}

export function toast(message: string, kind: 'ok' | 'error' = 'ok'): void {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 2800);
}
