// External
const capiFetch = require('@abcnews/capi-fetch').default;
const cn = require('classnames');
const html = require('bel');
const url2cmid = require('util-url2cmid');

// Ours
const { MS_VERSION, VIDEO_MARKER_PATTERN } = require('../../../constants');
const { enqueue, subscribe } = require('../../scheduler');
const { $, detach, isElement } = require('../../utils/dom');
const { dePx, formattedDate, getRatios, trim } = require('../../utils/misc');
const ScrollHint = require('../ScrollHint');
const Picture = require('../Picture');
const UParallax = require('../UParallax');
const VideoPlayer = require('../VideoPlayer');
const YouTubePlayer = require('../YouTubePlayer');
require('./index.scss');

function Header({
  meta = {},
  videoId,
  isVideoYouTube,
  imgEl,
  interactiveEl,
  ratios = {},
  isAbreast,
  isDark,
  isPale,
  isFloating,
  isLayered,
  isKicker,
  miscContentEls = []
}) {
  isFloating = isFloating || (isLayered && !imgEl && !videoId && !interactiveEl);
  isLayered = isLayered || isFloating;
  isDark = meta.isDarkMode || isLayered || isDark;
  isAbreast = !isFloating && !isLayered && (imgEl || videoId || interactiveEl) && isAbreast;

  const className = cn(
    'Header',
    {
      'is-abreast': isAbreast,
      'is-dark': isDark,
      'is-pale': isPale,
      'is-floating': isFloating,
      'is-layered': isLayered
    },
    'u-full'
  );

  ratios = {
    sm: ratios.sm || (isLayered ? '3x4' : '1x1'),
    md: ratios.md || (isLayered ? '1x1' : '3x2'),
    lg: isAbreast ? '3x4' : ratios.lg,
    xl: isAbreast ? '1x1' : ratios.xl
  };

  let mediaEl;

  if (interactiveEl) {
    mediaEl = interactiveEl.cloneNode(true);
  } else if (imgEl) {
    mediaEl = Picture({
      src: imgEl.src,
      alt: imgEl.getAttribute('alt'),
      ratios
    });
  } else if (videoId) {
    mediaEl = isVideoYouTube
      ? YouTubePlayer({
          videoId,
          isAmbient: true,
          ratios
        })
      : VideoPlayer({
          videoId,
          ratios,
          isInvariablyAmbient: true
        });
  }

  if (mediaEl && !interactiveEl && !isLayered && !isAbreast) {
    mediaEl.classList.add('u-parallax');
    UParallax.activate(mediaEl);
  }

  const clonedMiscContentEls = miscContentEls.map(el => {
    const clonedEl = el.cloneNode(true);

    clonedEl.classList.add('Header-miscEl');

    return clonedEl;
  });

  const clonedBylineNodes = meta.bylineNodes ? meta.bylineNodes.map(node => node.cloneNode(true)) : null;
  const infoSourceEl = meta.infoSource
    ? html`
        <p class="Header-infoSource">
          ${meta.infoSource.url
            ? html`
                <a href="${meta.infoSource.url}">${meta.infoSource.name}</a>
              `
            : meta.infoSource.name}
        </p>
      `
    : null;
  const [published, updated] = [meta.published, meta.updated].map(date =>
    date
      ? {
          datetime: date.toISOString(),
          text: formattedDate(date)
        }
      : null
  );

  const contentEls = [
    html`
      <h1>
        ${isKicker && meta.title.indexOf(': ') > -1
          ? meta.title.split(': ').map((text, index) =>
              index === 0
                ? html`
                    <small>${text}</small>
                  `
                : text
            )
          : meta.title}
      </h1>
    `
  ]
    .concat(clonedMiscContentEls)
    .concat([
      clonedBylineNodes
        ? html`
            <p class="Header-byline">${clonedBylineNodes}</p>
          `
        : null,
      infoSourceEl,
      updated
        ? html`
            <div class="Header-updated">Updated <time datetime="${updated.datetime}">${updated.text}</time></div>
          `
        : null,
      published
        ? html`
            <div class="Header-published">
              Published <time datetime="${published.datetime}">${published.text}</time>
            </div>
          `
        : null
    ]);

  const headerContentEl = html`
    <div class="Header-content u-richtext${isDark ? '-invert' : ''}">${contentEls}</div>
  `;

  const headerEl = html`
    <div class="${className}">
      ${mediaEl
        ? html`
            <div class="Header-media${isLayered && !isAbreast && mediaEl.tagName !== 'DIV' ? ' u-parallax' : ''}">
              ${!isLayered ? ScrollHint() : null} ${mediaEl}
            </div>
          `
        : null}
      ${headerContentEl}
    </div>
  `;

  fetchInfoSourceLogo(meta, infoSourceEl, isLayered ? 'layered' : isDark ? 'dark' : 'light');

  if (isAbreast) {
    subscribe(function _checkHeaderContentHeight(client) {
      if (client.hasChanged) {
        const headerContentElHeight = headerContentEl.getBoundingClientRect().height;
        const clientHeightMinusHeaderContentPeek = client.height - 152;
        headerEl.classList[headerContentElHeight > clientHeightMinusHeaderContentPeek ? 'add' : 'remove'](
          'has-content-taller-than-peek'
        );
      }
    });
  }

  if (isLayered && MS_VERSION > 9 && MS_VERSION < 12) {
    // https://github.com/philipwalton/flexbugs#3-min-height-on-a-flex-container-wont-apply-to-its-flex-items
    let heightOverride;

    subscribe(function _checkHeaderHeight(client) {
      if (client.hasChanged) {
        const headerElMinHeight = dePx(window.getComputedStyle(headerEl).minHeight);
        const headerContentElHeight = headerContentEl.getBoundingClientRect().height;
        const headerContentElMarginTop = dePx(window.getComputedStyle(headerContentEl).marginTop);

        const nextHeightOverride = Math.max(headerElMinHeight, headerContentElHeight + headerContentElMarginTop);

        if (nextHeightOverride !== heightOverride) {
          heightOverride = nextHeightOverride;
          enqueue(function _updateHeaderHeight() {
            headerEl.style.height = heightOverride + 'px';
          });
        }
      }
    });
  }

  return headerEl;
}

function fetchInfoSourceLogo(meta, el, variant) {
  if (!meta.infoSourceLogosDataId || !el) {
    return;
  }

  capiFetch(meta.infoSourceLogosDataId, (err, item) => {
    if (err) {
      return;
    }

    const logoDocs = item.contextSettings['meta.data.name'];
    const logoDoc = logoDocs[`${meta.infoSource.name} (${variant})`] || logoDocs[meta.infoSource.name];

    if (logoDoc) {
      capiFetch(logoDoc.id, (err, item) => {
        const image = item.media[0];
        el.className = `${el.className} has-logo`;
        // Assume image@2x, with height clamped between 50px and 75px
        el.style.height = `${Math.min(75, Math.max(50, Math.round(image.height / 2)))}px`;
        el.style.backgroundImage = `url(${image.url})`;
      });
    }
  });
}

function transformSection(section, meta) {
  const ratios = getRatios(section.configSC);
  const isFloating = section.configSC.indexOf('floating') > -1;
  const isLayered = isFloating || section.configSC.indexOf('layered') > -1;
  const isDark = isLayered || section.configSC.indexOf('dark') > -1;
  const isPale = section.configSC.indexOf('pale') > -1;
  const isAbreast = section.configSC.indexOf('abreast') > -1;
  const isNoMedia = isFloating || section.configSC.indexOf('nomedia') > -1;
  const isKicker = section.configSC.indexOf('kicker') > -1;
  const shouldSupplant = section.configSC.indexOf('supplant') > -1;

  let candidateNodes = section.betweenNodes;

  if (!isNoMedia && meta.relatedMedia != null) {
    candidateNodes = [meta.relatedMedia.cloneNode(true)].concat(candidateNodes);
  }

  if (shouldSupplant && candidateNodes.length) {
    detach(candidateNodes.shift());
  }

  const config = candidateNodes.reduce(
    (config, node) => {
      let classList = node.className ? node.className.split(' ') : [];
      let videoId;
      let imgEl;
      let interactiveEl;

      // If we found an init-interactive then it takes over being the header media
      if (!isNoMedia && !config.interactiveEl && isElement(node)) {
        // special case for parallax hash markers
        const isParallax = node.tagName === 'A' && node.getAttribute('name').indexOf('parallax') === 0;

        // normal init-interactives
        const isInteractive =
          classList.indexOf('init-interactive') > -1 ||
          node.querySelector('[class^="init-interactive"]') ||
          (node.tagName === 'A' && node.getAttribute('name').indexOf('interactive') === 0);

        if (isParallax || isInteractive) {
          config.interactiveEl = interactiveEl = node;
        }
      }

      if (!isNoMedia && !config.videoId && !config.imgEl && !config.interactiveEl && isElement(node)) {
        const leadVideoEl = $('video', node); // Phase 1 (Mobile) renders lead videos (Media field) as <video> elements

        if (leadVideoEl) {
          let parentEl = leadVideoEl.parentElement;

          while (parentEl.className.indexOf('media-wrapper-dl') === -1 && parentEl !== document.documentElement) {
            parentEl = parentEl.parentElement;
          }

          config.videoId = ((parentEl.getAttribute('data-uri') || '').match(/\d+/) || [null])[0];
        } else if (node.name && !!node.name.match(VIDEO_MARKER_PATTERN)) {
          config.isVideoYouTube = node.name.split('youtube')[1];
          config.videoId = videoId = node.name.match(VIDEO_MARKER_PATTERN)[1];
        } else {
          const linkEl = $('a[href]', node);

          videoId =
            linkEl &&
            ((classList.indexOf('inline-content') > -1 && classList.indexOf('video') > -1) ||
              classList.indexOf('view-inlineMediaPlayer') > -1 ||
              (classList.indexOf('view-hero-media') > -1 && $('.view-inlineMediaPlayer', node)) ||
              (classList.indexOf('embed-content') > -1 && $('.type-video', node))) &&
            url2cmid(linkEl.getAttribute('href'));

          if (videoId) {
            config.videoId = videoId;
          } else {
            imgEl = $('img', node);

            if (imgEl) {
              config.imgEl = imgEl;
            }
          }
        }
      }

      if (
        !videoId &&
        !imgEl &&
        !interactiveEl &&
        isElement(node) &&
        (trim(node.textContent).length > 0 || node.tagName === 'A')
      ) {
        config.miscContentEls.push(node);
      }

      return config;
    },
    {
      meta,
      ratios,
      isAbreast,
      isDark,
      isPale,
      isFloating,
      isLayered,
      isKicker,
      miscContentEls: []
    }
  );

  section.substituteWith(Header(config));
}

module.exports = Header;
module.exports.transformSection = transformSection;
