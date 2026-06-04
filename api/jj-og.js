// Per-prospect Open Graph image generator for Jimmys & Joes.
// Renders a 1200x630 PNG card with the prospect's name, position/class,
// school, J&J rating, and a key measurable. Parametric — pass everything
// as query params so this function never has to hit Firestore.
//
// Usage:
//   /api/jj-og?n=John+Doe&p=QB&c=2027&s=Allen+High+School&r=4.2&m=6%272%22+%C2%B7+195+lbs
//
// Wire-up via vercel.json: `/api/jj-og` (no rewrite needed beyond that).
//
// Requires `@vercel/og` in root package.json — see README.JJ-SETUP.md.

import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const GOLD   = '#F5C518';
const BLACK  = '#080808';
const WHITE  = '#F4F2ED';
const MUTED  = '#888884';
const BORDER = '#252525';

export default async function handler(req) {
  const url = new URL(req.url);
  const q = (k, d = '') => (url.searchParams.get(k) ?? d).slice(0, 120);
  const name    = q('n', 'Jimmys & Joes');
  const pos     = q('p', '');
  const cls     = q('c', '');
  const school  = q('s', '');
  const ratingS = q('r', '');
  const meas    = q('m', '');

  const rating = parseFloat(ratingS);
  const showRating = !isNaN(rating) && rating > 0;
  const stars = showRating ? renderStars(rating) : '';

  return new ImageResponse(
    {
      type: 'div',
      props: {
        style: {
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          background: BLACK, color: WHITE,
          padding: '60px 70px', position: 'relative',
          fontFamily: 'system-ui, sans-serif',
        },
        children: [
          // Top brand strip
          {
            type: 'div',
            props: {
              style: {
                display: 'flex', alignItems: 'center', gap: 14,
                fontSize: 22, fontWeight: 700, letterSpacing: 6,
                textTransform: 'uppercase', color: GOLD,
              },
              children: ['JIMMYS & JOES · 4TH & WARD'],
            },
          },

          // Class · Position eyebrow
          {
            type: 'div',
            props: {
              style: {
                marginTop: 36, display: 'flex', gap: 18,
                fontSize: 28, fontWeight: 700, letterSpacing: 3,
                textTransform: 'uppercase', color: GOLD,
              },
              children: [
                pos ? `${pos}` : '',
                pos && cls ? '·' : '',
                cls ? `Class of ${cls}` : '',
              ].filter(Boolean),
            },
          },

          // Name
          {
            type: 'div',
            props: {
              style: {
                marginTop: 18, fontSize: 96, fontWeight: 900,
                lineHeight: 1, letterSpacing: -2,
                textTransform: 'uppercase', color: WHITE,
                maxWidth: 1020, overflow: 'hidden',
              },
              children: [name],
            },
          },

          // School + locale
          school && {
            type: 'div',
            props: {
              style: {
                marginTop: 22, fontSize: 30, color: WHITE, opacity: 0.85,
              },
              children: [school],
            },
          },

          // Spacer
          { type: 'div', props: { style: { flex: 1 }, children: [] } },

          // Bottom rail: rating + measurables
          {
            type: 'div',
            props: {
              style: {
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderTop: `1px solid ${BORDER}`, paddingTop: 28,
              },
              children: [
                showRating ? {
                  type: 'div',
                  props: {
                    style: { display: 'flex', flexDirection: 'column', gap: 4 },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: { display: 'flex', alignItems: 'baseline', gap: 14 },
                          children: [
                            { type: 'div', props: { style: { fontSize: 88, fontWeight: 900, color: GOLD, lineHeight: 1 }, children: [rating.toFixed(1)] } },
                            { type: 'div', props: { style: { fontSize: 36, color: GOLD, letterSpacing: 4 }, children: [stars] } },
                          ],
                        },
                      },
                      { type: 'div', props: { style: { fontSize: 16, letterSpacing: 4, color: MUTED, textTransform: 'uppercase' }, children: ['J&J COMMUNITY RATING'] } },
                    ],
                  },
                } : {
                  type: 'div',
                  props: {
                    style: { fontSize: 24, color: MUTED, fontStyle: 'italic' },
                    children: ['Rate this prospect at 4thandward.com'],
                  },
                },
                meas && {
                  type: 'div',
                  props: {
                    style: { textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 4 },
                    children: [
                      { type: 'div', props: { style: { fontSize: 36, fontWeight: 800, color: WHITE }, children: [meas] } },
                      { type: 'div', props: { style: { fontSize: 14, letterSpacing: 4, color: MUTED, textTransform: 'uppercase' }, children: ['MEASURABLES'] } },
                    ],
                  },
                },
              ].filter(Boolean),
            },
          },

          // Decorative gold accent strip
          {
            type: 'div',
            props: {
              style: {
                position: 'absolute', top: 0, right: 0, bottom: 0, width: 8,
                background: `linear-gradient(180deg, ${GOLD} 0%, #C9A012 100%)`,
              },
              children: [],
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      headers: {
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    }
  );
}

function renderStars(rating) {
  const full = Math.floor(rating);
  const half = (rating - full) >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}
