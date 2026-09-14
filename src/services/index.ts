/**
 * The service layer's public surface.
 *
 * Screens import from '@/services' and nothing deeper. That is what kept the
 * move from the prototype's localStorage to Firestore from touching every
 * component: the shapes and most of the names are the same, the bodies moved
 * house.
 *
 * The split behind this barrel:
 *
 *   rules.ts        pure arithmetic and derivations. No network, no clock.
 *                   Every rupee the counter sees is computed here.
 *   <domain>.ts     one module per thing that writes: menu, orders, kitchen,
 *                   bills, customers, wallet, tables, settings, staff, audit.
 *   firebase/       the plumbing — app, paths, converters, listeners,
 *                   on-demand queries, offline-safe number blocks.
 *   context.ts      who is signed in and what is on screen, so services do
 *                   not need six arguments each.
 *
 * Writes are async. Reads over data already in memory stay synchronous, so
 * a component that just derives a total from the store needs no await and no
 * loading state.
 */

/* The cafe's rules: totals, bills, wallet balances, floor states. */
export * from './rules'

/* Things that write. */
export { authService, isValidUsername, normaliseUsername, usernameToEmail } from './auth'
export { menuService } from './menu'
export { orderService } from './orders'
export { kitchenService } from './kitchen'
export { billService } from './bills'
export { customerService } from './customers'
export { walletService } from './wallet'
export { tableService } from './tables'
export { settingsService, DEFAULT_SETTINGS, businessDayConfig } from './settings'
export { staffService } from './staff'
export { record as recordAudit } from './audit'

/* Reads that are not held in memory. */
export { queries } from './firebase/queries'
export type { Page, PageCursor, RangeQuery } from './firebase/queries'

/* Session context, for the store to wire up. */
export { currentSession, setServiceSession, setCatalogueSource } from './context'

/* Device identity and the offline number blocks, for Settings. */
export { deviceId, deviceLabel, setDeviceLabel } from './firebase/device'
export { primeSequences, remainingInBlock, SequenceExhaustedError } from './firebase/sequences'
