import { NS } from '../xml/types';
import { walkElements } from '../xml/query';
import { claimKey, emptyResult, type FormatAdapter } from './types';
import { usageOf } from './common';

const RES_RE = /^@\+?(android:)?(drawable|mipmap)\/[\w.]+$/;

/** Android layout XML and vector drawables. Images are resource references (@drawable/name) resolved through res/ folders. */
export const androidAdapter: FormatAdapter = {
  id: 'android',
  name: 'Android resource XML',
  designConversion: false,
  detect(doc) {
    const usesAndroidNs = [...walkElements(doc.root)].some((el) => el.attrs.some((a) => a.ns === NS.android));
    if (!usesAndroidNs) return null;
    const variant = doc.root.local === 'vector' ? 'Vector drawable' : doc.root.local === 'selector' || doc.root.local === 'shape' || doc.root.local === 'layer-list' ? 'Drawable resource' : 'Layout';
    return { score: 90, reason: 'Attributes use the Android namespace (http://schemas.android.com/apk/res/android).', variant };
  },
  async extract({ doc }) {
    const r = emptyResult();
    let views = 0;
    let textViews = 0;
    let vectorPaths = 0;
    let themeRefs = 0;
    for (const el of walkElements(doc.root)) {
      if (el.local === 'path' && doc.root.local === 'vector') vectorPaths++;
      else if (!['vector', 'group', 'selector', 'item', 'shape', 'layer-list', 'merge', 'include', 'requestFocus'].includes(el.local)) views++;
      if (/TextView$|Button$|EditText$/.test(el.local)) textViews++;
      for (const a of el.attrs) {
        if (a.ns !== NS.android && a.ns !== NS.androidAuto) continue;
        const v = a.value.trim();
        if (v.startsWith('?')) { if (/^(src|srcCompat|background|drawable\w*|icon|foreground)$/.test(a.local)) themeRefs++; continue; }
        if (!RES_RE.test(v)) continue;
        r.claimed.add(claimKey(a.pos.offset, a.name));
        r.references.push({
          key: `android:${v.replace('@+', '@')}`,
          kind: 'android-resource',
          value: v.replace('@+', '@'),
          label: v.slice(v.indexOf('/') + 1),
          adapter: 'android',
          confidence: 'schema',
          evidence: `In Android resources, "${v.slice(0, v.indexOf('/'))}/" values refer to drawable or mipmap image resources (${a.name}).`,
          usage: usageOf(el, a),
        });
      }
    }
    r.categories = doc.root.local === 'vector'
      ? [{ key: 'paths', label: 'Vector paths', count: vectorPaths }]
      : [
          { key: 'views', label: 'Views', count: views },
          { key: 'text', label: 'Text views / buttons', count: textViews },
          { key: 'drawables', label: 'Drawable references', count: r.references.length },
        ];
    if (themeRefs) r.ignored.push({ label: 'Theme attribute references (?attr/…)', count: themeRefs, reason: 'They depend on the app theme at run time and cannot be resolved from the files alone.' });
    r.notes.push('Android layouts position views with layout rules rather than coordinates, so only their images are extracted for now.');
    return r;
  },
};
