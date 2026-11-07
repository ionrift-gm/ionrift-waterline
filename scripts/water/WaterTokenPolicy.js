import { MODULE_ID } from '../data/moduleId.js';

/** @type {Set<string>} Classifier entity IDs representing innate flyers or hoverers */
export const AIRBORNE_ENTITY_IDS = new Set([
    'aberration_beholder',
    'undead_wraith',
    'undead_ghost',
    'elemental_air',
    'fey_sprite',
    'celestial_angel',
    'beast_avian',
    'beast_chiropteran',
    'monstrosity_harpy',
    'monstrosity_griffon',
    'monstrosity_manticore',
    'dragon',
    'dragon_wyvern',
    'dragon_pseudodragon',
    'construct_gargoyle',
    'gargoyle',
    'sprite',
    'harpy',
    'griffon',
    'manticore',
    'wraith'
]);

/** @type {Set<string>} Active status effect IDs that mark a token as airborne or non-wading */
export const AIRBORNE_STATUS_IDS = new Set([
    'flying',
    'fly',
    'hover',
    'hovering',
    'levitate',
    'levitating',
    'airborne',
    'flight',
    'incorporeal',
    'ethereal'
]);

/** @type {Set<string>} Foundry TokenDocument movement actions that do not wade through surface water */
export const AIRBORNE_MOVEMENT_ACTIONS = new Set([
    'fly',
    'hover',
    'blink',
    'teleport',
    'burrow'
]);

const FLYER_NAME_RE = /\b(butterfly|moth|flickerfly|wasp|bee|hornet|dragonfly|mosquito|stirge|bat|eagle|hawk|falcon|owl|raven|crow|vulture|roc|gull|seagull|albatross|harpy|griffon|hippogriff|pegasus|peryton|manticore|wyvern|dragon|drake|wyrm|pseudodragon|faerie dragon|dragonnel|pteranodon|quetzalcoatlus|cockatrice|couatl|gargoyle|pixie|sprite|angel|deva|planetar|solar|mephit|flameskull|demilich|beholder|spectator|gauth|death tyrant|wraith|ghost|specter|spectre|poltergeist|banshee|wisp|phantom|air elemental|djinni|invisible stalker|flying sword|cloaker|darkmantle|imp|quasit|spined devil|erinyes|vrock|chasme|aarakocra|owlin)\b/i;

const FLIGHTLESS_NAME_RE = /\b(penguin|ostrich|cassowary|emu|kiwi|dragon turtle|sea drake|river drake)\b/i;

const PASSIVE_FLIGHT_ITEM_RE = /^(fly|flight|flying|hover|hovering|incorporeal movement|air form|wings|winged|aerial\b)/i;

const NON_INNATE_ITEM_TYPES = new Set([
    'spell',
    'consumable',
    'loot',
    'equipment',
    'weapon',
    'container',
    'backpack',
    'tool'
]);

/**
 * Evaluates whether a token or creature is airborne/flying and whether it is eligible
 * to interact with surface water bodies (ripples, wakes, idle wavelets, and foley cues).
 */
export class WaterTokenPolicy {

    /**
     * Detect whether an actor has an innate or active fly/hover speed across D&D 5e, PF2e, SF2e, PF1e, and generic schemas.
     * @param {Actor|object|null|undefined} actor
     * @returns {boolean}
     */
    static hasActorFlySpeed(actor) {
        if (!actor?.system) return false;
        const sys = actor.system;

        // D&D 5e: system.attributes.movement.{fly, hover}
        const mov = sys.attributes?.movement;
        if (mov && (Number(mov.fly) > 0 || Boolean(mov.hover))) return true;

        // PF2e / SF2e: system.attributes.speed.otherSpeeds or system.movement.speeds.fly
        const otherSpeeds = sys.attributes?.speed?.otherSpeeds;
        if (Array.isArray(otherSpeeds)) {
            if (otherSpeeds.some(s => String(s?.type || '').toLowerCase() === 'fly' && (Number(s?.value) > 0 || Number(s?.total) > 0))) {
                return true;
            }
        }
        const pf2eFly = sys.movement?.speeds?.fly;
        if (pf2eFly && (Number(pf2eFly.value) > 0 || Number(pf2eFly.total) > 0 || Number(pf2eFly) > 0)) {
            return true;
        }
        if (String(sys.attributes?.speed?.type || '').toLowerCase() === 'fly') {
            return true;
        }

        // PF1e / D&D 3.5e: system.attributes.speed.fly
        const pf1eFly = sys.attributes?.speed?.fly;
        if (pf1eFly && (Number(pf1eFly.total) > 0 || Number(pf1eFly.base) > 0 || Number(pf1eFly) > 0)) {
            return true;
        }

        // Generic schemas
        if (sys.movement && (Number(sys.movement.fly) > 0 || Boolean(sys.movement.hover))) return true;
        if (sys.speed && (Number(sys.speed.fly) > 0 || Boolean(sys.speed.hover))) return true;
        if (Number(sys.flyingSpeed) > 0) return true;

        return false;
    }

    static #isExplicitSwimOnlyActor(actor) {
        if (!actor?.system) return false;
        const sys = actor.system;
        const mov = sys.attributes?.movement;
        if (mov && Number(mov.swim) > 0 && Number(mov.fly ?? 0) === 0 && !mov.hover) {
            return true;
        }
        const otherSpeeds = sys.attributes?.speed?.otherSpeeds;
        if (Array.isArray(otherSpeeds)) {
            const hasSwim = otherSpeeds.some(s => String(s?.type || '').toLowerCase() === 'swim' && (Number(s?.value) > 0 || Number(s?.total) > 0));
            const hasFly = otherSpeeds.some(s => String(s?.type || '').toLowerCase() === 'fly' && (Number(s?.value) > 0 || Number(s?.total) > 0));
            if (hasSwim && !hasFly) return true;
        }
        const pf2eSwim = sys.movement?.speeds?.swim;
        const pf2eFly = sys.movement?.speeds?.fly;
        if (pf2eSwim && (Number(pf2eSwim.value ?? pf2eSwim.total ?? pf2eSwim) > 0)) {
            const flyVal = Number(pf2eFly?.value ?? pf2eFly?.total ?? pf2eFly ?? 0);
            if (flyVal <= 0) return true;
        }
        return false;
    }

    static #hasAirborneStatusEffect(tokenDoc, actor) {
        const checkStatusCollection = (col) => {
            if (!col) return false;
            const iter = col instanceof Set || Array.isArray(col) ? col : null;
            if (!iter) return false;
            for (const s of iter) {
                if (typeof s === 'string' && AIRBORNE_STATUS_IDS.has(s.toLowerCase())) return true;
                if (s && typeof s === 'object') {
                    const id = String(s.id ?? s.statusId ?? s.name ?? '').toLowerCase();
                    if (AIRBORNE_STATUS_IDS.has(id)) return true;
                }
            }
            return false;
        };

        if (checkStatusCollection(actor?.statuses) || checkStatusCollection(tokenDoc?.statuses)) {
            return true;
        }

        const checkEffects = (effects) => {
            const list = effects?.contents ?? (Array.isArray(effects) ? effects : null);
            if (!list) return false;
            for (const eff of list) {
                if (!eff || eff.disabled || eff.isSuppressed) continue;
                if (checkStatusCollection(eff.statuses)) return true;
                const statusId = String(eff.statusId ?? eff.flags?.core?.statusId ?? '').toLowerCase();
                if (statusId && AIRBORNE_STATUS_IDS.has(statusId)) return true;
                const name = String(eff.name ?? eff.label ?? '').trim().toLowerCase();
                if (AIRBORNE_STATUS_IDS.has(name)) return true;
            }
            return false;
        };

        return checkEffects(actor?.effects) || checkEffects(tokenDoc?.effects);
    }

    /**
     * Determine whether a token or token document represents an airborne or flying creature.
     * @param {Token|TokenDocument|Actor|object|null|undefined} tokenOrDoc
     * @param {object|null} [changes=null]
     * @returns {boolean}
     */
    static isTokenAirborne(tokenOrDoc, changes = null) {
        if (!tokenOrDoc) return false;

        const tokenDoc = tokenOrDoc.document
            ?? ((tokenOrDoc.actor !== undefined || tokenOrDoc.elevation !== undefined || tokenOrDoc.movementAction !== undefined)
                ? tokenOrDoc
                : null);
        const actor = tokenOrDoc.actor
            ?? tokenDoc?.actor
            ?? ((tokenOrDoc.system !== undefined || tokenOrDoc.type !== undefined) ? tokenOrDoc : null);

        // 1. Positive elevation (above surface level 0)
        const rawElev = changes?.elevation
            ?? tokenDoc?.elevation
            ?? tokenDoc?._source?.elevation
            ?? tokenOrDoc.elevation
            ?? 0;
        const elevation = Number(rawElev) || 0;
        if (elevation > 0) return true;

        // 2. Foundry movement action / method
        const moveAction = String(
            changes?.movementAction
            ?? tokenDoc?.movementAction
            ?? tokenDoc?._source?.movementAction
            ?? ''
        ).toLowerCase();
        if (moveAction && AIRBORNE_MOVEMENT_ACTIONS.has(moveAction)) return true;

        // 3. Delegate to Ionrift Library Kernel classifier if loaded
        const libIsFlying = globalThis.game?.ionrift?.library?.isFlyingCreature;
        if (typeof libIsFlying === 'function') {
            if (libIsFlying(tokenOrDoc, { changes, elevation, movementAction: moveAction })) return true;
        }

        // 4. Active status effects / conditions
        if (WaterTokenPolicy.#hasAirborneStatusEffect(tokenDoc, actor)) return true;

        // 5. Explicit Actor fly/hover speed
        if (WaterTokenPolicy.hasActorFlySpeed(actor)) return true;

        // 6. Exclude explicitly flightless or swim-only creatures
        const creatureDetail = actor?.system?.details?.creature?.value ?? '';
        const typeValue = typeof actor?.system?.details?.type?.value === 'string' ? actor.system.details.type.value : '';
        const subtypeValue = typeof actor?.system?.details?.type?.subtype === 'string' ? actor.system.details.type.subtype : '';
        const combinedName = `${tokenDoc?.name ?? ''} ${tokenOrDoc?.name ?? ''} ${actor?.name ?? ''} ${creatureDetail} ${typeValue} ${subtypeValue}`.trim();

        if (FLIGHTLESS_NAME_RE.test(combinedName)) return false;
        if (WaterTokenPolicy.#isExplicitSwimOnlyActor(actor)) return false;

        // 7. Explicit flyer species / creature names
        if (FLYER_NAME_RE.test(combinedName)) return true;

        if (actor?.type === 'character') return false;

        // 8. System traits (e.g. PF2e "incorporeal", or "air" elemental/spirit)
        const rawTraits = actor?.system?.traits?.value;
        if (Array.isArray(rawTraits) || rawTraits instanceof Set) {
            const sysTraits = new Set(Array.from(rawTraits).map(t => String(t).toLowerCase()));
            if (sysTraits.has('incorporeal')) return true;
            if (sysTraits.has('air') && (sysTraits.has('elemental') || sysTraits.has('spirit'))) return true;
        }

        // 9. Passive/innate flight features on non-character actors
        const items = actor?.items?.contents ?? (Array.isArray(actor?.items) ? actor.items : null);
        if (items) {
            const mov = actor?.system?.attributes?.movement;
            const hasExplicitGroundedWalkOnly = Boolean(mov && Number(mov.walk) > 0 && Number(mov.fly ?? 0) === 0 && !mov.hover);
            if (!hasExplicitGroundedWalkOnly) {
                for (const item of items) {
                    if (!item || NON_INNATE_ITEM_TYPES.has(String(item.type ?? '').toLowerCase())) continue;
                    const itemName = String(item.name ?? '').trim();
                    if (PASSIVE_FLIGHT_ITEM_RE.test(itemName)) return true;
                }
            }
        }

        // 10. Optional Ionrift Library classifyCreature fallback
        const classifyCreature = globalThis.game?.ionrift?.library?.classifyCreature;
        if (typeof classifyCreature === 'function') {
            const target = actor ?? (combinedName || null);
            if (target) {
                const c = classifyCreature(target);
                if (c && c.id !== 'unknown') {
                    const tags = c.tags instanceof Set ? c.tags : new Set(c.tags ?? []);
                    if (
                        AIRBORNE_ENTITY_IDS.has(c.id)
                        || c.type === 'dragon'
                        || String(c.id ?? '').startsWith('dragon')
                        || tags.has('flying')
                        || tags.has('flight')
                        || tags.has('floating')
                        || tags.has('incorporeal')
                    ) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * Canonical gate determining whether a token is eligible to interact with water bodies
     * (wakes, ripples, idle wavelets, and water movement foley).
     * Returns false for GM-hidden tokens, explicit noRipple tokens, elevated tokens, and flying creatures.
     *
     * @param {Token|TokenDocument|object|null|undefined} tokenOrDoc
     * @param {object|null} [changes=null]
     * @returns {boolean}
     */
    static canTokenInteractWithWater(tokenOrDoc, changes = null) {
        if (!tokenOrDoc) return false;
        const tokenDoc = tokenOrDoc.document ?? tokenOrDoc;

        // GM-hidden tokens never emit visual ripples or splash audio
        if (tokenDoc?.hidden) return false;

        // Per-token opt-out flag
        const noRipple = Boolean(
            tokenDoc?.getFlag?.(MODULE_ID, 'noRipple')
            ?? tokenDoc?.flags?.[MODULE_ID]?.noRipple
        );
        if (noRipple) return false;

        // Flying / airborne / hovering creatures never interact with surface water bodies
        if (WaterTokenPolicy.isTokenAirborne(tokenOrDoc, changes)) return false;

        return true;
    }
}
