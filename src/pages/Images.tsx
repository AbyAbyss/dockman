// Images — local library, registry pull (with the Podman → Docker
// architecture fallback), layer history from `image history`, and a
// registry breakdown computed from the image names.

import { useMemo, useState } from 'react';
import { BentoCard } from '@/components/ui/BentoCard';
import { StatTile } from '@/components/ui/StatTile';
import { PillButton } from '@/components/ui/PillButton';
import { Glyph } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Badge';
import { Ring } from '@/components/ui/Charts';
import { RuntimeBadge } from '@/components/ui/Runtime';
import { RunContainerModal } from '@/components/ui/RunContainerModal';
import { useAppStore } from '@/store/appStore';
import { ACCENTS, useThemeStore } from '@/store/themeStore';
import { logActivity } from '@/store/activityStore';
import { useImages, useRuntimes } from '@/hooks/useData';
import { useResource } from '@/hooks/useResource';
import { ContainerCommands, HostCommands, ImageCommands, runtimesFor, type ImageLayer } from '@/lib/commands';
import { fallbackPlatform, isArchMismatch } from '@/lib/archFallback';
import { formatBytes } from '@/lib/parsers';
import { RUNTIME_BRAND } from '@/data/runtimes';
import type { ImageItem, RuntimeName } from '@/types';

/** Registry host of an image reference; bare names live on Docker Hub. */
function registryOf(name: string): string {
  const first = name.split('/')[0];
  if (name.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost')) {
    return first;
  }
  return 'docker.io';
}

export default function Images() {
  const query = useAppStore((s) => s.query);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const containers = useAppStore((s) => s.containers);
  const refreshContainers = useAppStore((s) => s.refresh);
  const accent = ACCENTS[useThemeStore((s) => s.accent)].hex;
  const autoFallback = useThemeStore((s) => s.m1Fallback);
  const { runtimes } = useRuntimes();
  const imagesRes = useImages(runtimeFilter);
  const images = imagesRes.data;

  const [pullInput, setPullInput] = useState('');
  const [pulling, setPulling] = useState<{ name: string } | null>(null);
  /** Outcome of the last pull; `dockerPlatform` offers the Docker fallback. */
  const [pullMsg, setPullMsg] = useState<{
    tone: 'error' | 'info';
    text: string;
    dockerPlatform?: string;
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tagging, setTagging] = useState(false);
  const [tagValue, setTagValue] = useState('');
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [configureImage, setConfigureImage] = useState<{
    image: string;
    rt: RuntimeName;
  } | null>(null);

  /** Image references currently used by a container, per runtime. */
  const inUse = useMemo(() => {
    const set = new Set<string>();
    for (const c of containers) set.add(`${c.rt}|${c.image}`);
    return set;
  }, [containers]);
  const isUsed = (img: ImageItem) =>
    inUse.has(`${img.rt}|${img.name}:${img.tag}`) ||
    inUse.has(`${img.rt}|${img.name}`) ||
    (img.tag === 'latest' && inUse.has(`${img.rt}|${img.name}`)) ||
    inUse.has(`${img.rt}|${img.id}`);

  const filtered = images.filter(
    (img) => !query || (img.name + img.tag).toLowerCase().includes(query.toLowerCase()),
  );
  const totalBytes = images.reduce((s, i) => s + i.sizeBytes, 0);
  const usedCount = images.filter(isUsed).length;
  const usedBytes = images.filter(isUsed).reduce((s, i) => s + i.sizeBytes, 0);

  const registries = useMemo(() => {
    const map = new Map<string, number>();
    for (const img of images) map.set(registryOf(img.name), (map.get(registryOf(img.name)) ?? 0) + 1);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [images]);

  const runPull = (name: string, rt: RuntimeName, platform?: string) => {
    // `pull` reports no progress over the CLI call, so the bar is
    // indeterminate until the command returns.
    setPulling({ name });

    ImageCommands.pull(rt, name, platform)
      .then(() => {
        setPulling(null);
        logActivity('pull', rt, name, platform ? `as ${platform}` : '');
        if (platform) setPullMsg({ tone: 'info', text: `Pulled ${name} on docker as ${platform}` });
        imagesRes.refetch();
      })
      .catch((e) => {
        const msg = String(e);
        if (rt === 'podman' && runtimes.docker.found && isArchMismatch(msg)) {
          const plat = fallbackPlatform(runtimes.docker.arch);
          logActivity('fallback', 'podman', name, `arch mismatch, docker ${plat}`);
          if (autoFallback) {
            setPullMsg({ tone: 'info', text: `Arch mismatch on podman, pulling on docker (${plat})` });
            runPull(name, 'docker', plat);
            return;
          }
          setPulling(null);
          setPullMsg({ tone: 'error', text: msg, dockerPlatform: plat });
          return;
        }
        setPulling(null);
        logActivity('error', rt, name, msg);
        setPullMsg({ tone: 'error', text: msg });
      });
  };

  const startPull = () => {
    if (!pullInput.trim() || pulling) return;
    setPullMsg(null);
    runPull(pullInput.trim(), runtimeFilter === 'podman' ? 'podman' : 'docker');
  };

  const detail = selected ? images.find((i) => i.id === selected) : null;
  const history = useResource<ImageLayer[]>(
    () => (detail ? HostCommands.imageHistory(detail.rt, detail.id) : Promise.resolve([])),
    [],
    [detail?.rt, detail?.id],
  );

  const report = (p: Promise<unknown>, okMsg: string, rt: RuntimeName, kind: 'remove' | 'prune' | 'pull' | 'run', target: string) =>
    p
      .then(() => {
        setActionMsg(okMsg);
        logActivity(kind, rt, target);
        imagesRes.refetch();
        refreshContainers();
      })
      .catch((e) => {
        setActionMsg(String(e));
        logActivity('error', rt, target, String(e));
      });

  const removeImage = () => {
    if (!detail) return;
    report(ImageCommands.remove(detail.rt, detail.id), `Removed ${detail.name}:${detail.tag}`, detail.rt, 'remove', `${detail.name}:${detail.tag}`);
    setSelected(null);
  };

  const runImage = () => {
    if (!detail) return;
    report(
      ContainerCommands.run(detail.rt, {
        image: `${detail.name}:${detail.tag}`,
        ports: [],
        env: [],
        volumes: [],
        command: [],
        detach: true,
      }),
      `Started a container from ${detail.name}:${detail.tag}`,
      detail.rt,
      'run',
      `${detail.name}:${detail.tag}`,
    );
  };

  const pushImage = () => {
    if (!detail) return;
    setActionMsg(`Pushing ${detail.name}:${detail.tag}…`);
    ImageCommands.push(detail.rt, `${detail.name}:${detail.tag}`)
      .then(() => setActionMsg(`Pushed ${detail.name}:${detail.tag}`))
      .catch((e) => setActionMsg(String(e)));
  };

  const pruneImages = () => {
    for (const rt of runtimesFor(runtimeFilter)) {
      ImageCommands.prune(rt)
        .then((out) => {
          const line = out.split('\n').find((l) => l.toLowerCase().includes('reclaimed')) ?? 'done';
          setActionMsg(`${rt}: ${line.trim()}`);
          logActivity('prune', rt, 'images', line.trim());
          imagesRes.refetch();
        })
        .catch((e) => setActionMsg(`${rt}: ${String(e)}`));
    }
  };

  const openTag = () => {
    if (!detail) return;
    setTagValue(`${detail.name}:${detail.tag}`);
    setTagging(true);
  };

  const applyTag = () => {
    if (!detail || !tagValue.trim()) return;
    ImageCommands.tag(detail.rt, `${detail.name}:${detail.tag}`, tagValue.trim())
      .then(() => {
        setActionMsg(`Tagged ${tagValue.trim()}`);
        imagesRes.refetch();
      })
      .catch((e) => setActionMsg(String(e)));
    setTagging(false);
  };

  return (
    <div className="bento">
      <div className="stat-trio" style={{ gridColumn: 'span 5' }}>
        <StatTile value={images.length} label="Local images" section="Library" sectionIcon="image" tone="violet" />
        <StatTile value={(totalBytes / 1e9).toFixed(2)} label="On disk" section="Storage" sectionIcon="disk" tone="default" suffix=" GB" />
        <StatTile value={usedCount} label="In use" section="Active" sectionIcon="container" tone="default" suffix="" />
      </div>

      <BentoCard section="Storage" sectionIcon="disk" title="Breakdown" span={4} headerAlign="left">
        <div className="storage-row" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Ring pct={totalBytes ? Math.round((usedBytes / totalBytes) * 100) : 0} accent={accent} size={72} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="storage-val">{formatBytes(usedBytes)}</div>
            <div className="storage-sub mono">used by running or stopped containers</div>
            <div className="storage-sub mono">{formatBytes(totalBytes - usedBytes)} in unused images</div>
          </div>
        </div>
      </BentoCard>

      <BentoCard section="Registry" sectionIcon="arrow" title="Pull Image" span={3} headerAlign="left">
        <div className="pull-form">
          <div className="pull-input">
            <Glyph name="image" size={13} />
            <input
              value={pullInput}
              onChange={(e) => setPullInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') startPull();
              }}
              placeholder="image:tag"
            />
          </div>
          <button className="action-btn primary" type="button" onClick={startPull} disabled={!!pulling || !pullInput.trim()}>
            {pulling ? (
              'Pulling…'
            ) : (
              <>
                Pull <Glyph name="arrow" size={12} />
              </>
            )}
          </button>
        </div>
        {pulling && (
          <div className="pull-progress">
            <div className="pull-bar">
              <div className="pull-fill is-indeterminate" />
            </div>
            <div className="pull-meta mono">{pulling.name} · pulling</div>
          </div>
        )}
        {pullMsg && !pulling && (
          <div className={`${pullMsg.tone === 'error' ? 'rcm-error' : 'rcm-note'} mono`}>
            {pullMsg.text}
            {pullMsg.dockerPlatform && (
              <div style={{ marginTop: 8 }}>
                <button
                  className="action-btn"
                  type="button"
                  onClick={() => {
                    const plat = pullMsg.dockerPlatform;
                    setPullMsg(null);
                    runPull(pullInput.trim(), 'docker', plat);
                  }}
                >
                  Pull on Docker as {pullMsg.dockerPlatform}
                </button>
              </div>
            )}
          </div>
        )}
        <div className="pull-suggest">
          {['nginx:alpine', 'redis:7', 'postgres:16', 'node:20'].map((s) => (
            <button key={s} className="pull-chip mono" type="button" onClick={() => setPullInput(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="pull-meta mono">
          pulls on {runtimeFilter === 'podman' ? 'podman' : 'docker'}
        </div>
      </BentoCard>

      <BentoCard
        section="Library"
        sectionIcon="image"
        title={`Local Images · ${filtered.length}`}
        span={8}
        headerAlign="left"
        headerAside={
          <button className="text-btn" type="button" onClick={pruneImages}>
            Prune unused →
          </button>
        }
      >
        {actionMsg && <div className="rcm-note mono" style={{ marginBottom: 10 }}>{actionMsg}</div>}
        {filtered.length === 0 ? (
          <div className="empty">
            <Glyph name="image" size={24} />
            <div>{imagesRes.loading ? 'Loading images…' : 'No images found.'}</div>
          </div>
        ) : (
          <div className="img-grid">
            {filtered.map((img, i) => (
              <button
                key={img.rt + img.id + img.tag}
                type="button"
                className={`img-card ${selected === img.id ? 'is-on' : ''}`}
                onClick={() => {
                  setSelected(selected === img.id ? null : img.id);
                  setTagging(false);
                }}
              >
                <div className={`img-thumb thumb-${i % 4}`}>
                  <span className="thumb-id">
                    {(img.name.split('/').pop() || '?')[0].toUpperCase()}
                  </span>
                  <span className="img-card-rt" style={{ background: RUNTIME_BRAND[img.rt].accent }} />
                </div>
                <div className="img-card-body">
                  <div className="img-card-name">{img.name}</div>
                  <div className="img-card-tag mono">:{img.tag}</div>
                  <div className="img-card-meta">
                    <Pill tone={isUsed(img) ? 'ok' : 'dim'}>{isUsed(img) ? 'in use' : 'unused'}</Pill>
                    <span className="mono">{img.size}</span>
                  </div>
                  <div className="img-card-foot mono">
                    <span>
                      {img.id} · {img.built}
                    </span>
                    <RuntimeBadge rt={img.rt} size="xs" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </BentoCard>

      <BentoCard
        section="Inspect"
        sectionIcon="image"
        title={detail ? 'Image Detail' : 'Registries'}
        span={4}
        headerAlign="left"
      >
        {detail ? (
          <div className="img-detail">
            <div className="img-detail-h">
              <div className="img-detail-name">
                {detail.name}
                <span className="mono">:{detail.tag}</span>
              </div>
              <div className="img-detail-sub mono">{detail.id}</div>
            </div>
            <div className="kv">
              <div>
                <span>Size</span>
                <b>{detail.size}</b>
              </div>
              <div>
                <span>Layers</span>
                <b>{history.loading ? '…' : history.data.length}</b>
              </div>
              <div>
                <span>Built</span>
                <b>{detail.built}</b>
              </div>
              <div>
                <span>Runtime</span>
                <b>{detail.rt}</b>
              </div>
            </div>
            <div className="layer-list">
              <div className="bc-section">
                <span>Layer history</span>
              </div>
              {history.error && <div className="rcm-error mono">{history.error}</div>}
              {history.data.slice(0, 12).map((l, i) => (
                <div key={i} className="layer-row mono" title={l.createdBy}>
                  <span className="layer-sha">{l.id && l.id !== '<missing>' ? l.id.slice(0, 7) : '·'}</span>
                  <span className="layer-cmd">
                    {l.createdBy.replace(/^\/bin\/sh -c (#\(nop\) )?/, '').slice(0, 60)}
                  </span>
                  <span className="layer-sz">{l.sizeBytes ? formatBytes(l.sizeBytes) : '0 B'}</span>
                </div>
              ))}
              {history.data.length > 12 && (
                <div className="pull-meta mono">+{history.data.length - 12} more layers</div>
              )}
            </div>
            <div className="det-actions">
              <button className="action-btn" type="button" onClick={runImage}>
                <Glyph name="play" size={12} /> Run
              </button>
              <button
                className="action-btn"
                type="button"
                onClick={() =>
                  setConfigureImage({
                    image: `${detail.name}:${detail.tag}`,
                    rt: detail.rt,
                  })
                }
              >
                <Glyph name="settings" size={12} /> Configure
              </button>
              <button className="action-btn" type="button" onClick={pushImage}>
                Push
              </button>
              <button className="action-btn" type="button" onClick={openTag}>
                <Glyph name="plus" size={12} /> Tag
              </button>
              <button className="action-btn danger" type="button" onClick={removeImage}>
                <Glyph name="trash" size={12} />
              </button>
            </div>
            {tagging && (
              <div className="pull-form">
                <div className="pull-input">
                  <Glyph name="image" size={13} />
                  <input
                    value={tagValue}
                    onChange={(e) => setTagValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyTag();
                    }}
                    placeholder="new-name:tag"
                    autoFocus
                  />
                </div>
                <button className="action-btn primary" type="button" onClick={applyTag}>
                  Apply
                </button>
              </div>
            )}
          </div>
        ) : registries.length === 0 ? (
          <div className="empty" style={{ padding: '20px 8px' }}>
            <Glyph name="image" size={20} />
            <div>Pull an image to see where your images come from.</div>
          </div>
        ) : (
          <div className="pill-grid">
            {registries.map(([name, count]) => (
              <PillButton
                key={name}
                icon={name === 'docker.io' ? 'image' : 'extension'}
                label={name}
                sub={`${count} ${count === 1 ? 'image' : 'images'}`}
                status="ok"
              />
            ))}
          </div>
        )}
      </BentoCard>

      {configureImage && (
        <RunContainerModal
          defaultRuntime={configureImage.rt}
          defaultImage={configureImage.image}
          onClose={() => setConfigureImage(null)}
        />
      )}
    </div>
  );
}
