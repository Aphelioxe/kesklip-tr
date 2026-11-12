(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KesKlipTimeline = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN_CLIP_DURATION = 0.12;
  const MIN_TRANSITION_DURATION = 0.12;
  const TRANSITION_TYPES = Object.freeze(['soft', 'flash', 'slide', 'zoom', 'wipe', 'circle']);
  const CLIP_EFFECTS = Object.freeze(['punch', 'shake', 'flash']);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getClipSourceDuration(clip) {
    return Math.max(0, Number(clip.outPoint) - Number(clip.inPoint));
  }

  function getClipDuration(clip) {
    const speed = Math.max(0.1, Number(clip.speed) || 1);
    return Math.max(MIN_CLIP_DURATION, getClipSourceDuration(clip) / speed);
  }

  function getClipFades(clip) {
    const duration = getClipDuration(clip);
    const fadeIn = clamp(Number(clip.fadeIn) || 0, 0, duration * 0.5);
    const fadeOut = clamp(Number(clip.fadeOut) || 0, 0, duration * 0.5);
    return { fadeIn, fadeOut };
  }

  function getEffectiveTransition(clips, index) {
    if (!Array.isArray(clips) || index < 0 || index >= clips.length - 1) return null;
    const transition = clips[index].transitionAfter;
    if (!transition || transition.type === 'none') return null;
    const duration = Number(transition.duration);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    const leftDuration = getClipDuration(clips[index]);
    const rightDuration = getClipDuration(clips[index + 1]);
    const effective = Math.min(duration, leftDuration * 0.45, rightDuration * 0.45);
    if (effective < MIN_TRANSITION_DURATION) return null;
    return { type: transition.type, duration: effective };
  }

  function computeLayout(project) {
    const clips = Array.isArray(project && project.clips) ? project.clips : [];
    const items = [];
    const transitions = [];
    let cursor = 0;

    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      const duration = getClipDuration(clip);
      let start = cursor;

      if (index > 0) {
        const transition = getEffectiveTransition(clips, index - 1);
        if (transition) {
          start = Math.max(0, cursor - transition.duration);
          const previous = items[index - 1];
          transitions.push({
            afterIndex: index - 1,
            beforeClipIndex: index,
            type: transition.type,
            duration: transition.duration,
            start,
            end: cursor,
          });
        }
      }

      const item = {
        clip,
        index,
        start,
        end: start + duration,
        duration,
      };
      items.push(item);
      cursor = item.end;
    }

    return {
      items,
      transitions,
      duration: items.length ? items[items.length - 1].end : 0,
    };
  }

  function getActiveItems(layout, time) {
    if (!layout || !layout.items.length) return [];
    const epsilon = 0.0005;
    const active = layout.items.filter(
      (item) => time >= item.start - epsilon && time < item.end - epsilon
    );
    if (active.length) return active;
    // At the exact end of the project keep the final clip visible so the
    // preview does not flash black while the playhead sits at the end.
    if (Math.abs(time - layout.duration) <= epsilon) {
      return [layout.items[layout.items.length - 1]];
    }
    return [];
  }

  function getTransitionAtTime(layout, time) {
    if (!layout) return null;
    return (
      layout.transitions.find(
        (transition) => time >= transition.start && time < transition.end
      ) || null
    );
  }

  function timeToSource(item, time) {
    const speed = Math.max(0.1, Number(item.clip.speed) || 1);
    const source = Number(item.clip.inPoint) + (time - item.start) * speed;
    return clamp(source, Number(item.clip.inPoint), Number(item.clip.outPoint));
  }

  function formatClock(seconds, withFrames) {
    const safe = Math.max(0, Number(seconds) || 0);
    const totalFrames = Math.floor(safe * 30 + 0.0001);
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = Math.floor(safe % 60);
    const pad = (value, size) => String(value).padStart(size, '0');
    if (withFrames) {
      const frames = totalFrames % 30;
      return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}.${pad(frames, 2)}`;
    }
    if (hours > 0) {
      return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}`;
    }
    return `${pad(minutes, 2)}:${pad(secs, 2)}`;
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    if (safe < 60) {
      return `${safe.toFixed(1).replace('.0', '')} sn`;
    }
    const minutes = Math.floor(safe / 60);
    const secs = Math.round(safe % 60);
    if (minutes < 60) return `${minutes} dk ${String(secs).padStart(2, '0')} sn`;
    const hours = Math.floor(minutes / 60);
    return `${hours} sa ${minutes % 60} dk`;
  }

  function escapeFilterText(value) {
    return String(value == null ? '' : value).replace(/[\\:']/g, '\\$&');
  }

  return {
    MIN_CLIP_DURATION,
    MIN_TRANSITION_DURATION,
    TRANSITION_TYPES,
    CLIP_EFFECTS,
    clamp,
    getClipSourceDuration,
    getClipDuration,
    getClipFades,
    getEffectiveTransition,
    computeLayout,
    getActiveItems,
    getTransitionAtTime,
    timeToSource,
    formatClock,
    formatDuration,
    escapeFilterText,
  };
});
