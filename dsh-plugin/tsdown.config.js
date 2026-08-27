"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * tsdown build for dsh-leek-fund: the host-half lib (lib/index.js, ESM node)
 * plus one browser client bundle (lib/client.js, CJS closure factory) that
 * registers with the package-name id `dsh-leek-fund` through the official
 * DSH client-modules channel.
 *
 * The client bundle replicates the official DSH client-bundle preset
 * (packages/client/tsdown.client.ts):
 * - externals resolve through the loader module table at runtime
 *   (CLIENT_EXTERNALS below — the PLATFORM_MODULES seed list),
 * - everything else is inlined into the bundle,
 * - the purity gate rejects Node builtins and cross-plugin @deepseek-ai value
 *   imports (collaboration goes through cordis services),
 * - CSS Modules compile to hashed class maps and inject <style data-plugin>
 *   tags at factory execution,
 * - the artifact registers itself via window.__ModuleLoader__.load({id,
 *   factory}) with the (require) => exports CJS closure shape.
 */
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const node_module_1 = require("node:module");
const node_url_1 = require("node:url");
const lightningcss_1 = require("lightningcss");
const require = (0, node_module_1.createRequire)(import.meta.url);
/** Node builtins must never survive into the browser module-loader factory. */
const NODE_BUILTINS = new Set([
    ...node_module_1.builtinModules,
    ...node_module_1.builtinModules.map(id => `node:${id}`),
]);
/** Module specifiers the web shell shares into the frozen module table. */
const CLIENT_EXTERNALS = [
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/client',
    'cordis',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-web-react',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-schema-form',
    '@deepseek-ai/dsh-client-runtime/client',
];
/** Wire/type layers a client bundle may inline (browser-safe, no identity). */
const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand)(\/|$)/;
const CSS_VIRTUAL_PREFIX = '\0dsh-css:';
const CSS_VIRTUAL_SUFFIX = '.mjs';
const REPOSITORY_ROOT = (0, node_url_1.fileURLToPath)(new URL('.', import.meta.url));
/** Style-injection prologue shared by module css and plain css loads. */
function injectTag(pluginId, fileId, cssText) {
    const tagId = `${pluginId}/${(0, node_path_1.basename)(fileId)}`;
    return [
        `const css = ${JSON.stringify(cssText)};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
        `  const tag = document.createElement('style');`,
        `  tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
        `  tag.dataset.pluginCss = tagId;`,
        `  tag.textContent = css;`,
        `  document.head.appendChild(tag);`,
        `}`,
    ].join('\n');
}
/** Rebase a physical lib-relative source onto the repository-shaped URL tree. */
function browserSourcePath(source, sourcemapPath) {
    if (!source.startsWith('.'))
        return source;
    const physicalSource = (0, node_path_1.resolve)((0, node_path_1.dirname)(sourcemapPath), source);
    const repositoryPath = (0, node_path_1.relative)(REPOSITORY_ROOT, physicalSource).split(node_path_1.sep).join('/');
    return `../../../${repositoryPath}`;
}
/** One client bundle build for the plugin id (official profile channel). */
function clientBundle(pluginId, entryFile) {
    var _a, _b, _c;
    return {
        entry: { client: 'src/client/index.tsx' },
        outDir: 'lib',
        format: 'cjs',
        platform: 'browser',
        dts: false,
        sourcemap: true,
        clean: false,
        external: [...CLIENT_EXTERNALS],
        define: {
            'process.env.NODE_ENV': JSON.stringify((_a = process.env.NODE_ENV) !== null && _a !== void 0 ? _a : 'production'),
            'import.meta.env.MODE': JSON.stringify((_b = process.env.NODE_ENV) !== null && _b !== void 0 ? _b : 'production'),
            'import.meta.env': JSON.stringify({ MODE: (_c = process.env.NODE_ENV) !== null && _c !== void 0 ? _c : 'production' }),
            'import.meta.resolve': 'undefined',
        },
        inputOptions: {
            resolve: {
                conditionNames: ['browser', 'import', 'require', 'default'],
            },
        },
        noExternal: (id) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
        plugins: [purityGatePlugin(), makeCssPlugin(pluginId)],
        outputOptions: {
            entryFileNames: entryFile,
            sourcemapPathTransform: browserSourcePath,
            banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pluginId)}, factory: (require) => {`,
            footer: `return module.exports; } });`,
            intro: 'var module = { exports: {} }; var exports = module.exports;',
            codeSplitting: false,
        },
    };
}
/** The client-bundle purity gate. */
function purityGatePlugin() {
    return {
        name: 'dsh-client-bundle-purity',
        resolveId(source) {
            if (NODE_BUILTINS.has(source)) {
                throw new Error(`client bundle purity: Node builtin "${source}" cannot run in the browser module table — `
                    + 'select the dependency browser export or add an explicit browser implementation');
            }
            if (!source.startsWith('@deepseek-ai/'))
                return null;
            if (CLIENT_EXTERNALS.includes(source))
                return null;
            if (INLINE_SAFE.test(source))
                return null;
            throw new Error(`client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS) and not an inline-safe wire layer — `
                + 'cross-plugin value imports are forbidden; collaborate through cordis services');
        },
    };
}
/** CSS-inline virtual-module plugin (one <style data-plugin> per file). */
function makeCssPlugin(pluginId) {
    return {
        name: 'dsh-css-inline',
        resolveId(source, importer) {
            if (!source.endsWith('.css'))
                return null;
            let abs;
            if (source.startsWith('.') || source.startsWith('/') || /^[A-Za-z]:[\\/]/.test(source)) {
                abs = importer === undefined ? source : (0, node_path_1.resolve)((0, node_path_1.dirname)(importer), source);
            }
            else {
                abs = require.resolve(source);
            }
            return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX;
        },
        load(virtualId) {
            return __awaiter(this, void 0, void 0, function* () {
                if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX))
                    return null;
                const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length);
                this.addWatchFile(fileId);
                const source = yield (0, promises_1.readFile)(fileId);
                if (fileId.endsWith('.module.css')) {
                    const { code, exports: cssExports } = (0, lightningcss_1.transform)({
                        filename: fileId,
                        code: source,
                        cssModules: { pattern: `[hash]_[local]` },
                        minify: true,
                    });
                    const classMap = {};
                    for (const [local, exp] of Object.entries(cssExports !== null && cssExports !== void 0 ? cssExports : {}))
                        classMap[local] = exp.name;
                    return [
                        injectTag(pluginId, fileId, code.toString()),
                        `export default ${JSON.stringify(classMap)};`,
                    ].join('\n');
                }
                return [
                    injectTag(pluginId, fileId, source.toString('utf8')),
                    'export default "";',
                ].join('\n');
            });
        },
    };
}
exports.default = [
    {
        entry: { index: 'src/index.ts' },
        outDir: 'lib',
        format: ['esm'],
        platform: 'node',
        target: 'es2024',
        fixedExtension: false,
        dts: false,
        clean: false,
    },
    clientBundle('dsh-leek-fund', 'client.js'),
];
