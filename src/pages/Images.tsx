// Images — local library and registry view: a dense table beside a pane
// carrying the disk breakdown, registries and the reclaim callout.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Glyph } from '@/components/ui/Icon';
import { RunContainerModal } from '@/components/ui/RunContainerModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { useAppStore } from '@/store/appStore';
import { useImages } from '@/hooks/useData';
import { ImageCommands, failureOf } from '@/lib/commands';
import { RUNTIMES } from '@/data/seed';
import { scopeOf, type ImageItem, type RuntimeName } from '@/types';

/** Repository avatars cycle through the palette so rows stay distinguishable. */
const AVATAR_TONES = ['a', 'b', 'c', 'd', 'e'];

function sizeToMB(size: string): number {
  const v = parseFloat(size);
  if (Number.isNaN(v)) return 0;
  return size.includes('GB') ? v * 1024 : v;
}

function fmtGB(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** Canonical image reference: drops the docker.io/library/ prefix podman adds,
 *  any digest, and defaults a missing tag to latest. */
function normRef(ref: string): string {
  let r = ref.split('@')[0].replace(/^docker\.io\//, '').replace(/^library\//, '');
  if (r.lastIndexOf(':') <= r.lastIndexOf('/')) r += ':latest';
  return r;
}

export default function Images() {
  const query = useAppStore((s) => s.query);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const containers = useAppStore((s) => s.containers);
  const reportError = useAppStore((s) => s.reportError);
  const reportOk = useAppStore((s) => s.reportOk);
  const addProblem = useAppStore((s) => s.addProblem);
  const imagesRes = useImages(runtimeFilter);
  const loading = imagesRes.loading;

  // USED BY names the containers (running or stopped) created from an image,
  // on the same runtime — matched by normalised repo:tag or by image id.
  const usersOf = (img: ImageItem) => {
    const ref = normRef(`${img.name}:${img.tag}`);
    return containers
      .filter((c) => {
        if (c.rt !== img.rt) return false;
        const cref = normRef(c.image);
        if (cref === ref) return true;
        const hex = c.image.replace(/^sha256:/, '');
        return /^[0-9a-f]{12,}$/.test(hex) && (img.id.startsWith(hex) || hex.startsWith(img.id));
      })
      .map((c) => c.name);
  };
  // The CLI listing carries no usage, so `used` is derived from the containers.
  const images = useMemo(
    () => imagesRes.data.map((i) => ({ ...i, used: usersOf(i).length > 0 })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imagesRes.data, containers],
  );

  const [pullInput, setPullInput] = useState('postgres:16-alpine');
  const [pulling, setPulling] = useState<{
    name: string;
    rt: RuntimeName;
    progress: number;
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tagging, setTagging] = useState(false);
  const [tagValue, setTagValue] = useState('');
  const [confirmPrune, setConfirmPrune] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<ImageItem | null>(null);
  const [runTarget, setRunTarget] = useState<{ image: string; rt: RuntimeName } | null>(
    null,
  );
  const pullTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (pullTimer.current) clearInterval(pullTimer.current);
    },
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? images.filter((i) => (i.name + i.tag).toLowerCase().includes(q))
      : images;
  }, [images, query]);

  const usedMB = images.filter((i) => i.used).reduce((s, i) => s + sizeToMB(i.size), 0);
  const idleMB = images.filter((i) => !i.used).reduce((s, i) => s + sizeToMB(i.size), 0);
  const totalMB = usedMB + idleMB;
  const unusedCount = images.filter((i) => !i.used).length;

  const detail = selected ? images.find((i) => i.id === selected) : null;

  const startPull = () => {
    if (!pullInput.trim() || pulling) return;
    const name = pullInput;
    const rt: RuntimeName = runtimeFilter === 'podman' ? 'podman' : 'docker';
    setPulling({ name, rt, progress: 0 });

    // The CLI does not stream a percentage, so the bar only creeps towards
    // 95% and the strip stays up until the real pull settles.
    let p = 0;
    pullTimer.current = window.setInterval(() => {
      p += (95 - p) * 0.06;
      setPulling({ name, rt, progress: Math.round(p) });
    }, 280);

    const done = imagesRes.live
      ? ImageCommands.pull(rt, name).then(
          (res) => {
            reportOk(
              res.emulated
                ? `Pulled ${name} · ${(res.platform ?? 'foreign-arch').replace('linux/', '')}, runs emulated`
                : `Pulled ${name}`,
            );
            imagesRes.refetch();
          },
          (e) => {
            const f = failureOf(e);
            if (f.problem) addProblem(f.problem);
            reportError(f.problem ? f.problem.message : f.message);
          },
        )
      : new Promise<void>((r) => setTimeout(r, 3000));
    done.finally(() => {
      if (pullTimer.current) clearInterval(pullTimer.current);
      pullTimer.current = null;
      setPulling(null);
    });
  };

  const removeImage = (img: ImageItem) => {
    if (imagesRes.live) {
      ImageCommands.remove(scopeOf(img), img.id)
        .then(() => imagesRes.refetch())
        .catch(reportError);
    }
    if (selected === img.id) setSelected(null);
  };

  const pushImage = () => {
    if (!detail) return;
    ImageCommands.push(scopeOf(detail), `${detail.name}:${detail.tag}`)
      .then(() => reportOk(`Pushed ${detail.name}:${detail.tag}`))
      .catch(reportError);
  };

  const pruneImages = async () => {
    // 'all' means both engines — pruning only docker silently left podman's
    // unreferenced images behind, which read as "the button does nothing".
    const targets: RuntimeName[] =
      runtimeFilter === 'all' ? ['docker', 'podman'] : [runtimeFilter];
    const results = await Promise.allSettled(
      targets.map((rt) => ImageCommands.prune(rt)),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    failed.forEach((r) => reportError((r as PromiseRejectedResult).reason));
    if (failed.length < targets.length) {
      reportOk(`Pruned unused images · reclaimed about ${fmtGB(idleMB)}`);
    }
    imagesRes.refetch();
  };

  const applyTag = () => {
    if (!detail || !tagValue.trim()) return;
    ImageCommands.tag(scopeOf(detail), `${detail.name}:${detail.tag}`, tagValue.trim())
      .then(() => imagesRes.refetch())
      .catch(reportError);
    setTagging(false);
    setTagValue('');
  };

  return (
    <div className="split-screen">
      <div className="split-main">
        {/* ─── Toolbar ─────────────────────────────────────────────────── */}
        <div className="ctr-toolbar">
          <div className="pull-field">
            <Glyph name="arrow" size={12} sw={1.7} />
            <input
              className="mono"
              value={pullInput}
              placeholder="image:tag"
              onChange={(e) => setPullInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') startPull();
              }}
            />
          </div>
          <button
            type="button"
            className="tool-btn is-primary"
            disabled={!!pulling}
            onClick={startPull}
          >
            <Glyph name="arrow" size={12} sw={2} />
            {pulling ? `Pulling ${pulling.progress}%` : 'Pull image'}
          </button>

          <div className="ctr-tools">
            <span className="toolbar-note mono">
              {unusedCount} unused · {fmtGB(idleMB)} reclaimable
            </span>
            <button
              type="button"
              className="tool-btn is-danger"
              disabled={unusedCount === 0}
              onClick={() => setConfirmPrune(true)}
            >
              <Glyph name="trash" size={12} />
              Prune unused
            </button>
          </div>
        </div>

        {pulling && (
          <div className="pull-strip">
            <span className="mono">
              pulling {pulling.name} · {pulling.rt}
            </span>
            <div className="track">
              <div className="track-fill" style={{ width: `${pulling.progress}%` }} />
            </div>
            <span className="mono">{pulling.progress}%</span>
          </div>
        )}

        {/* ─── Table ───────────────────────────────────────────────────── */}
        <div className="ctr-thead img-cols mono">
          <span className="col-repo">REPOSITORY</span>
          <span className="col-tag">TAG</span>
          <span className="col-size">SIZE</span>
          <span className="col-layers">LAYERS</span>
          <span className="col-used">USED BY</span>
          <span className="col-built">BUILT</span>
          <span className="col-iact">ACTIONS</span>
        </div>

        <div className="ctr-body">
          {filtered.length === 0 && loading && (
            <SkeletonRows rows={7} variant="image" />
          )}
          {filtered.length === 0 && !loading && (
            <div className="empty">
              <Glyph name="image" size={24} />
              <div>
                {images.length === 0
                  ? 'No images cached yet — pull one to get started.'
                  : 'No images match this search.'}
              </div>
            </div>
          )}
          {filtered.map((img, i) => {
            const leaf = img.name.split('/').pop() || img.name;
            const users = usersOf(img);
            return (
              <div
                key={img.id}
                className={`img-row img-cols ${selected === img.id ? 'is-focused' : ''}`}
                onClick={() => setSelected(selected === img.id ? null : img.id)}
              >
                <div className="col-repo">
                  <span className={`img-avatar tone-${AVATAR_TONES[i % AVATAR_TONES.length]}`}>
                    {leaf.charAt(0).toUpperCase()}
                  </span>
                  <span className="img-name mono">{img.name}</span>
                  <span
                    className="ctr-rt"
                    title={img.root ? `${img.rt} · root store` : img.rt}
                    style={{ background: RUNTIMES[img.rt]?.accent }}
                  />
                </div>
                <span className="col-tag mono">{img.tag}</span>
                <span className="col-size mono">{img.size}</span>
                <span className="col-layers mono">{img.layers}</span>
                <span
                  className={`col-used mono ${users.length ? '' : 'is-idle'}`}
                  title={users.join(', ')}
                >
                  {users.length === 0
                    ? '—'
                    : users.length === 1
                      ? users[0]
                      : `${users[0]} +${users.length - 1}`}
                </span>
                <span className="col-built mono">{img.built}</span>
                <div className="col-iact" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="text-chip"
                    onClick={() =>
                      setRunTarget({ image: `${img.name}:${img.tag}`, rt: img.rt })
                    }
                  >
                    run
                  </button>
                  <button
                    type="button"
                    className="row-btn is-danger"
                    title="Remove image"
                    onClick={() => setConfirmRemove(img)}
                  >
                    <Glyph name="trash" size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Right pane ────────────────────────────────────────────────── */}
      <aside className="side-pane">
        {detail && (
          <div className="side-block">
            <div className="section-label">SELECTED IMAGE</div>
            <div className="side-title mono">
              {detail.name}:{detail.tag}
            </div>
            {tagging ? (
              <div className="tag-form">
                <input
                  className="field mono"
                  autoFocus
                  value={tagValue}
                  placeholder="new:tag"
                  onChange={(e) => setTagValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyTag();
                    if (e.key === 'Escape') setTagging(false);
                  }}
                />
                <button type="button" className="tool-btn is-primary" onClick={applyTag}>
                  Tag
                </button>
              </div>
            ) : (
              <div className="side-actions">
                <button
                  type="button"
                  className="det-action"
                  onClick={() => {
                    setTagValue(`${detail.name}:`);
                    setTagging(true);
                  }}
                >
                  Tag
                </button>
                <button type="button" className="det-action" onClick={pushImage}>
                  Push
                </button>
                <button
                  type="button"
                  className="det-action is-danger"
                  onClick={() => setConfirmRemove(detail)}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        )}

        <div className="side-block">
          <div className="section-label">DISK</div>
          <div className="side-stat">{fmtGB(totalMB)}</div>
          <div className="side-sub mono">across {images.length} image{images.length === 1 ? '' : 's'}</div>
          <div className="seg-bar">
            <div
              className="seg tone-a"
              style={{ width: `${totalMB ? (usedMB / totalMB) * 100 : 0}%` }}
            />
            <div
              className="seg tone-b"
              style={{ width: `${totalMB ? (idleMB / totalMB) * 100 : 0}%` }}
            />
          </div>
          <div className="seg-legend mono">
            <span>
              <i className="tone-a" /> in use {fmtGB(usedMB)}
            </span>
            <span>
              <i className="tone-b" /> idle {fmtGB(idleMB)}
            </span>
          </div>
        </div>

        {idleMB > 0 && (
          <div className="callout">
            <div className="callout-title">Reclaim {fmtGB(idleMB)}</div>
            <div className="callout-body mono">
              {unusedCount} image{unusedCount === 1 ? '' : 's'} are not referenced by any
              container. Pruning removes them and their unshared layers.
            </div>
            <button
              type="button"
              className="tool-btn is-primary"
              onClick={() => setConfirmPrune(true)}
            >
              Reclaim {fmtGB(idleMB)}
            </button>
          </div>
        )}
      </aside>

      {runTarget && (
        <RunContainerModal
          defaultRuntime={runTarget.rt}
          defaultImage={runTarget.image}
          onClose={() => setRunTarget(null)}
        />
      )}
      {confirmPrune && (
        <ConfirmDialog
          title="Prune unused images?"
          body={`${unusedCount} unreferenced image${unusedCount === 1 ? '' : 's'} and their unshared layers will be deleted, reclaiming about ${fmtGB(idleMB)}. This cannot be undone.`}
          confirmLabel="Prune"
          onConfirm={pruneImages}
          onClose={() => setConfirmPrune(false)}
        />
      )}
      {confirmRemove && (
        <ConfirmDialog
          title="Remove image?"
          body={`${confirmRemove.name}:${confirmRemove.tag} (${confirmRemove.rt}) will be force-removed, even if containers still reference it. This cannot be undone.`}
          confirmLabel="Remove"
          onConfirm={() => removeImage(confirmRemove)}
          onClose={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}
