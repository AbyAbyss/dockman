// Images — registry & local library view with an animated pull flow.

import { useEffect, useRef, useState } from 'react';
import { BentoCard } from '@/components/ui/BentoCard';
import { StatTile } from '@/components/ui/StatTile';
import { PillButton } from '@/components/ui/PillButton';
import { Glyph, type IconName } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Badge';
import { Ring } from '@/components/ui/Charts';
import { RuntimeBadge } from '@/components/ui/Runtime';
import { RunContainerModal } from '@/components/ui/RunContainerModal';
import { useAppStore } from '@/store/appStore';
import { ACCENTS, useThemeStore } from '@/store/themeStore';
import { useImages } from '@/hooks/useData';
import { ContainerCommands, ImageCommands } from '@/lib/commands';
import { RUNTIMES } from '@/data/seed';
import type { RuntimeName } from '@/types';

const LAYER_CMDS = ['FROM base', 'COPY src', 'RUN npm ci', 'COPY dist', 'CMD ["node"]'];
const LAYER_SIZES = ['64MB', '12MB', '24MB', '8MB', '< 1MB'];

const SOURCES: { name: string; count: number; icon: IconName }[] = [
  { name: 'Docker Hub', count: 7, icon: 'image' },
  { name: 'ghcr.io', count: 3, icon: 'extension' },
  { name: 'gcr.io', count: 1, icon: 'cpu' },
  { name: 'self-hosted', count: 2, icon: 'volume' },
];

function sizeToMB(size: string): number {
  const v = parseFloat(size);
  if (Number.isNaN(v)) return 0;
  return size.includes('GB') ? v * 1024 : v;
}

export default function Images() {
  const query = useAppStore((s) => s.query);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const refreshContainers = useAppStore((s) => s.refresh);
  const accent = ACCENTS[useThemeStore((s) => s.accent)].hex;
  const imagesRes = useImages(runtimeFilter);
  const images = imagesRes.data;

  const [pullInput, setPullInput] = useState('postgres:16-alpine');
  const [pulling, setPulling] = useState<{ name: string; progress: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tagging, setTagging] = useState(false);
  const [tagValue, setTagValue] = useState('');
  const [configureImage, setConfigureImage] = useState<{
    image: string;
    rt: RuntimeName;
  } | null>(null);
  const pullTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (pullTimer.current) clearInterval(pullTimer.current);
    },
    [],
  );

  const filtered = images.filter(
    (img) => !query || (img.name + img.tag).toLowerCase().includes(query.toLowerCase()),
  );
  const totalSize = images.reduce((s, i) => s + sizeToMB(i.size), 0);

  const startPull = () => {
    if (!pullInput.trim() || pulling) return;
    const name = pullInput;
    setPulling({ name, progress: 0 });

    if (imagesRes.live) {
      const rt = runtimeFilter === 'podman' ? 'podman' : 'docker';
      ImageCommands.pull(rt, name)
        .then(() => imagesRes.refetch())
        .catch(() => undefined);
    }

    let p = 0;
    pullTimer.current = window.setInterval(() => {
      p += 8 + Math.random() * 12;
      if (p >= 100) {
        if (pullTimer.current) clearInterval(pullTimer.current);
        pullTimer.current = null;
        setPulling(null);
        return;
      }
      setPulling({ name, progress: Math.round(p) });
    }, 280);
  };

  const detail = selected ? images.find((i) => i.id === selected) : null;

  const removeImage = () => {
    if (!detail) return;
    if (imagesRes.live) {
      ImageCommands.remove(detail.rt, detail.id)
        .then(() => imagesRes.refetch())
        .catch(() => undefined);
    }
    setSelected(null);
  };

  const runImage = () => {
    if (!detail) return;
    ContainerCommands.run(detail.rt, {
      image: `${detail.name}:${detail.tag}`,
      ports: [],
      env: [],
      volumes: [],
      command: [],
      detach: true,
    })
      .then(() => refreshContainers())
      .catch(() => undefined);
  };

  const pushImage = () => {
    if (!detail) return;
    ImageCommands.push(detail.rt, `${detail.name}:${detail.tag}`).catch(
      () => undefined,
    );
  };

  const pruneImages = () => {
    ImageCommands.prune(runtimeFilter === 'podman' ? 'podman' : 'docker')
      .then(() => imagesRes.refetch())
      .catch(() => undefined);
  };

  const openTag = () => {
    if (!detail) return;
    setTagValue(`${detail.name}:`);
    setTagging(true);
  };

  const applyTag = () => {
    if (!detail || !tagValue.trim()) return;
    ImageCommands.tag(detail.rt, `${detail.name}:${detail.tag}`, tagValue.trim())
      .then(() => imagesRes.refetch())
      .catch(() => undefined);
    setTagging(false);
    setTagValue('');
  };

  return (
    <div className="bento">
      <div className="stat-trio" style={{ gridColumn: 'span 5' }}>
        <StatTile value={images.length} label="Local images" section="Library" sectionIcon="image" tone="violet" />
        <StatTile value={images.filter((i) => i.used).length} label="In use" section="Active" sectionIcon="bolt" tone="default" />
        <StatTile value={images.filter((i) => !i.used).length} label="Unused" section="Reclaim" sectionIcon="trash" tone="warn" suffix="" />
      </div>

      <BentoCard section="Disk" sectionIcon="disk" title="Image Storage" span={4} headerAlign="left">
        <div className="storage-row">
          <Ring pct={Math.min(100, Math.round((totalSize / 4096) * 100))} accent={accent} size={72} />
          <div className="storage-meta">
            <div className="storage-val">{(totalSize / 1024).toFixed(1)} GB</div>
            <div className="storage-sub mono">of 4 GB allocated</div>
            <div className="storage-bar">
              <div className="storage-seg" style={{ width: '38%', background: accent }} />
              <div className="storage-seg" style={{ width: '22%', background: 'color-mix(in oklab, var(--accent) 60%, var(--bg))' }} />
              <div className="storage-seg" style={{ width: '12%', background: 'color-mix(in oklab, var(--accent) 30%, var(--bg))' }} />
            </div>
            <div className="storage-legend">
              <span>
                <i style={{ background: accent }} /> active 38%
              </span>
              <span>
                <i style={{ background: 'color-mix(in oklab, var(--accent) 60%, var(--bg))' }} /> cache 22%
              </span>
              <span>
                <i style={{ background: 'color-mix(in oklab, var(--accent) 30%, var(--bg))' }} /> dangling 12%
              </span>
            </div>
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
              placeholder="image:tag"
            />
          </div>
          <button className="action-btn primary" type="button" onClick={startPull} disabled={!!pulling}>
            {pulling ? (
              `${pulling.progress}%`
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
              <div className="pull-fill" style={{ width: `${pulling.progress}%` }} />
            </div>
            <div className="pull-meta mono">{pulling.name} · downloading layers</div>
          </div>
        )}
        <div className="pull-suggest">
          {['nginx:alpine', 'redis:7.2', 'postgres:16', 'node:20'].map((s) => (
            <button key={s} className="pull-chip mono" type="button" onClick={() => setPullInput(s)}>
              {s}
            </button>
          ))}
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
        {filtered.length === 0 ? (
          <div className="empty">
            <Glyph name="image" size={24} />
            <div>{imagesRes.loading ? 'Loading images…' : 'No images found.'}</div>
          </div>
        ) : (
          <div className="img-grid">
            {filtered.map((img, i) => (
              <button
                key={img.id + img.tag}
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
                  <span className="img-card-rt" style={{ background: RUNTIMES[img.rt].accent }} />
                </div>
                <div className="img-card-body">
                  <div className="img-card-name">{img.name}</div>
                  <div className="img-card-tag mono">:{img.tag}</div>
                  <div className="img-card-meta">
                    <Pill tone={img.used ? 'ok' : 'dim'}>{img.used ? 'in use' : 'unused'}</Pill>
                    <span className="mono">{img.size}</span>
                  </div>
                  <div className="img-card-foot mono">
                    <span>
                      {img.layers} layers · {img.built}
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
        title={detail ? 'Image Detail' : 'Top Sources'}
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
                <b>{detail.layers || '—'}</b>
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
              {Array.from({ length: Math.min(detail.layers || 5, 5) }).map((_, i) => (
                <div key={i} className="layer-row mono">
                  <span className="layer-sha">sha:{(0x100000 + i * 0x4d2f).toString(16).slice(0, 6)}</span>
                  <span className="layer-cmd">{LAYER_CMDS[i]}</span>
                  <span className="layer-sz">{LAYER_SIZES[i]}</span>
                </div>
              ))}
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
        ) : (
          <div className="pill-grid">
            {SOURCES.map((r) => (
              <PillButton key={r.name} icon={r.icon} label={r.name} sub={`${r.count} images`} status="ok" />
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
