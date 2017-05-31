// External
const html = require('bel');
const playInline = require('iphone-inline-video');
const url2cmid = require('util-url2cmid');
const xhr = require('xhr');

// Ours
const {append, isElement, select, selectAll, setText, toggleAttribute, twoDigits} = require('../../../utils');
const {nextFrame, subscribe} = require('../../loop');

const BACKGROUND_IMAGE_PATTERN = /url\(['"]?(.*\.\w*)['"]?\)/;
const API_URL_ROOT = 'https://content-gateway.abc-prod.net.au/api/v1/content/id/';

const players = [];
let phase1InlineVideoConfig;

function VideoPlayer({
  posterURL,
  sources = [],
  isAmbient,
  isAutoplay,
  isFullscreen,
  isLoop,
  isMuted,
  scrollplayPct
}) {
  if (isAmbient) {
    isAutoplay = true;
    isFullscreen = true;
    isLoop = true;
  }

  if (isAutoplay || scrollplayPct) {
    isMuted = true;
  }

  const videoEl = html`<video
    poster="${posterURL ? posterURL : ''}"
    preload="${scrollplayPct ? 'auto' : 'none'}"
    tabindex="-1"></video>`;

  const booleanAttributes = {
    autoplay: isAutoplay,
    loop: isLoop,
    muted: isMuted,
    playsinline: true,
    scrollplay: !!scrollplayPct,
    'webkit-playsinline': true
  };

  Object.keys(booleanAttributes).forEach(attributeName => {
    toggleAttribute(videoEl, attributeName, booleanAttributes[attributeName]);
  });

  sources.forEach(source => {
    append(videoEl, html`<source src="${source.src}" type="${source.type}" />`);
  });

  // iOS8-9 inline video (muted only)
  if (scrollplayPct || isAutoplay) {
    nextFrame(() => {
      playInline(videoEl, !isMuted);
    });
  }

  const timeRemainingEl = html`<time class="VideoPlayer-timeRemaining"></time>`;
  const progressBarEl = html`<progress class="VideoPlayer-progressBar" value="0"></progress>`;

  const player = {
    isAutoplay,
    scrollplayPct,
    getRect: () => {
      return videoEl.getBoundingClientRect();
    },
    toggleMute: event => {
      event.stopPropagation();
      player.isUserInControl = true;
      videoEl.muted = !videoEl.muted;
      toggleAttribute(videoEl, 'muted', videoEl.muted);
    },
    togglePlay: (event, wasScrollBased) => {
      const wasPaused = videoEl.paused;
      
      if (!wasScrollBased) {
        player.isUserInControl = true;
      }

      if (wasPaused) {
        selectAll('video').forEach(otherVideoEl => {
          if (otherVideoEl !== videoEl && !otherVideoEl.paused && !otherVideoEl.hasAttribute('autoplay')) {
            otherVideoEl.pause();
            otherVideoEl.removeAttribute('playing');
          }
        });
      }

      const attrToggle = toggleAttribute.bind(null, videoEl, 'playing', wasPaused);
      const promise = videoEl[wasPaused ? 'play' : 'pause']();

      if (promise) {
        promise.then(attrToggle);
      } else {
        attrToggle();
      }

      setTimeout(() => {
        videoEl.removeAttribute('ended');
      }, 300);
    },
    updatePlaybackPosition: () => {
      const secondsRemaining = videoEl.duration - videoEl.currentTime;
      const progress = videoEl.currentTime / videoEl.duration;

      setText(timeRemainingEl, isNaN(secondsRemaining) ? '' : `${
        secondsRemaining > 0 ? '-' : ''
      }${
        twoDigits(Math.floor(secondsRemaining / 60))
      }:${
        twoDigits(Math.round(secondsRemaining % 60))
      }`);

      progressBarEl.setAttribute('value', progress);

      player.previousTime = Math.floor(videoEl.currentTime);
    }
  };

  players.push(player);

  const playbackUpdateInterval = setInterval(() => {
	  if (videoEl.readyState > 0 && Math.floor(videoEl.currentTime) !== player.previousTime) {
      player.updatePlaybackPosition();
    }
  }, 1000);

  videoEl.addEventListener('ended', () => {
    player.isUserInControl = true;
    videoEl.currentTime = 0;
    videoEl.removeAttribute('playing', '');
    videoEl.setAttribute('ended', '');
  });

  return html`
    <div class="VideoPlayer">
      <div class="u-sizer-sm-16x9 u-sizer-md-16x9 u-sizer-lg-16x9"></div>
      ${videoEl}
      ${isAmbient ? null : html`
        <div role="button"
          class="VideoPlayer-interface"
          tabindex="0"
          onkeydown=${whenActionKey(event => event.preventDefault())}
          onkeyup=${whenActionKey(player.togglePlay)}
          onclick=${player.togglePlay}>
          <button
            class="VideoPlayer-mute"
            title="Mute control"
            onkeyup=${whenActionKey(event => event.stopPropagation())}
            onclick=${player.toggleMute}></button>
          <div class="VideoPlayer-progress">
            ${progressBarEl}
            ${timeRemainingEl}
          </div>
        </div>
      `}
    </div>
  `;
};

function whenActionKey(fn) {
  return function (event) {
     if (event.target === this && (event.keyCode === 32 || event.keyCode === 13)) {
        fn(event);
     }
  };
}

function UnpublishedVideoPlaceholder(title) {
  return html`
    <div class="UnpublishedVideoPlaceholder" title="Video ID: ${title}">
      <div class="u-sizer-sm-16x9 u-sizer-md-16x9 u-sizer-lg-16x9"></div>
      <p>
        Unpublished videos cannot be previewed on the mobile site. Try the
        <a target="_blank" href="${
          window.location.href.replace('/mobile/', '/')
        }">standard site</a>.
      </p>
    </div>
  `;
}

function getMetadata(videoElOrId, callback) {
  function done(err, metadata) {
    nextFrame(() => {
      callback(err, metadata);
    });
  }

  if (isElement(videoElOrId)) {
    done(null, {
      posterURL: videoElOrId.poster,
      sources: formatSources(selectAll('source', videoElOrId))
    });
  } else if ('WCMS' in window) {
    // Phase 2
    // * Sources & poster are nested inside global `WCMS` object

    Object.keys(WCMS.pluginCache.plugins.videoplayer)
    .some(key => {
      const config = WCMS.pluginCache.plugins.videoplayer[key][0].videos[0];

      if (config.url.indexOf(videoElOrId) > -1) {
        return done(null, {
          posterURL: config.thumbnail.replace('-thumbnail', '-large'),
          sources: formatSources(config.sources, 'label')
        });
      }
    });
  } else if ('inlineVideoData' in window) {
    // Phase 1 (Standard)
    // * Sources are nested inside global `inlineVideoData` object
    // * Poster may be inferred from original embed's partial jwplayer transform
    
    selectAll('.inline-content.video[data-inline-video-data-index]')
    .some(el => {
      if (select(`[href*="/${videoElOrId}"]`, el)) {
        const posterEl = select('img, .inline-video', el);

        return done(null, {
          posterURL: posterEl ? (posterEl.src || posterEl.style.backgroundImage.slice(5, -2)) : null,
          sources: formatSources(window.inlineVideoData[el.getAttribute('data-inline-video-data-index')])
        });
      }
    });
  } else {
    // Phase 1 (Mobile):
    // * Doesn't embed video; only teases to it.
    // * Video must be published because...
    // * Sources and poster must be fetched from live Content API

    xhr({
      json: true,
      url: `${API_URL_ROOT}${videoElOrId}`
    }, (err, response, body) => {
      if (err || response.statusCode !== 200) {
        return done(err || new Error(response.statusCode));
      }

      const posterId = body.relatedItems.length > 0 ? body.relatedItems[0].id : null;

      done(null, {
        posterURL: posterId ? `/news/image/${posterId}-16x9-940x529.jpg` : null,
        sources: formatSources(body.renditions)
      });
    });
  }
}

function formatSources(sources, sortProp = 'bitrate') {
  return sources
  .sort((a, b) => +a[sortProp] < +b[sortProp])
  .map(source => ({
    src: source.src || source.url,
    type: source.type || source.contentType
  }));
}

function measure(viewport) {
  players.forEach(player => {
    const rect = player.getRect();
    const scrollplayExtent = (viewport.height / 100 * (player.scrollplayPct || 0));

    player.isVisible = (
      // Fully inside viewport
      (rect.top >= 0 && rect.bottom <= viewport.height) ||
      // Fully covering viewport
      (rect.top <= 0 && rect.bottom >= viewport.height) ||
      // Top within scrollplay range
      (rect.top >= 0 && rect.top <= (viewport.height - scrollplayExtent)) ||
      // Bottom within scrollplay range
      (rect.bottom >= scrollplayExtent && (rect.bottom <= viewport.height))
    );
  });
}

function mutate() {
  players.forEach(player => {
    if (player.isUserInControl || player.isAutoplay || !player.scrollplayPct) {
      return;
    }

    if (
      (typeof player.wasVisible === 'undefined' && player.isVisible) ||
      (typeof player.wasVisible !== 'undefined' && player.isVisible !== player.wasVisible)
    ) {
      player.togglePlay(null, true);
    }

    player.wasVisible = player.isVisible;
  });
}

subscribe({
  measure,
  mutate
});

module.exports = VideoPlayer;
module.exports.UnpublishedVideoPlaceholder = UnpublishedVideoPlaceholder;
module.exports.getMetadata = getMetadata;
