import type {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase/firestore'
import type {
  AuditEntry,
  Bill,
  CafeSettings,
  CafeTable,
  Category,
  Customer,
  MenuItem,
  ModifierGroup,
  ModifierOption,
  Order,
  Outlet,
  StaffIndexEntry,
  StaffMember,
  UsernameClaim,
  Station,
  WalletEntry,
} from '@/types'

/**
 * Typed converters between Firestore documents and the domain models.
 *
 * Two deliberate shape differences from the plain models:
 *
 *  - `id` is the document id and is NOT duplicated inside the document. It
 *    is stripped on write and put back on read, so a document can never
 *    disagree with its own path.
 *  - Modifier options are stored NESTED inside their group rather than in
 *    their own collection. They are tiny, never read without the group, and
 *    nesting turns "load the menu" from N+M reads into N.
 *
 * Domain timestamps stay ISO strings rather than Firestore Timestamps. They
 * sort and range-query identically as strings, and keeping them as strings
 * means no Date round-trip anywhere in the UI. `serverUpdatedAt` is the one
 * real Timestamp, written by the server, used for debugging clock skew.
 */

/** Fields the client never writes and the reader never surfaces. */
interface ServerFields {
  serverUpdatedAt?: Timestamp
}

function stripId<T extends { id: string }>(model: T): DocumentData {
  const { id: _ignored, ...rest } = model
  return rest
}

/** The common case: the document is the model minus its id. */
function idConverter<T extends { id: string }>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (model: T) => stripId(model),
    fromFirestore: (snap: QueryDocumentSnapshot): T => {
      const { serverUpdatedAt: _s, ...data } = snap.data() as DocumentData & ServerFields
      return { ...(data as Omit<T, 'id'>), id: snap.id } as T
    },
  }
}

export const outletConverter = idConverter<Outlet>()
export const staffConverter = idConverter<StaffMember>()
export const stationConverter = idConverter<Station>()
export const categoryConverter = idConverter<Category>()
export const menuItemConverter = idConverter<MenuItem>()
export const tableConverter = idConverter<CafeTable>()
export const orderConverter = idConverter<Order>()
export const billConverter = idConverter<Bill>()
export const customerConverter = idConverter<Customer>()
export const walletEntryConverter = idConverter<WalletEntry>()
export const auditConverter = idConverter<AuditEntry>()
export const staffIndexConverter = idConverter<StaffIndexEntry>()
export const usernameClaimConverter = idConverter<UsernameClaim>()

/* --------------------------- Modifier groups --------------------------- */

/**
 * A group as it is STORED: its options live inside it. The store flattens
 * these back into the `modifierOptions` array the UI already expects, so no
 * screen has to know about the nesting.
 */
export interface StoredModifierGroup extends ModifierGroup {
  options: ModifierOption[]
}

export const modifierGroupConverter: FirestoreDataConverter<StoredModifierGroup> = {
  toFirestore: (model: StoredModifierGroup) => stripId(model),
  fromFirestore: (snap: QueryDocumentSnapshot): StoredModifierGroup => {
    const data = snap.data() as DocumentData
    const options = Array.isArray(data.options) ? (data.options as ModifierOption[]) : []
    return {
      ...(data as Omit<StoredModifierGroup, 'id' | 'options'>),
      // Guard against an option written before it carried its parent id.
      options: options.map((o) => ({ ...o, modifierGroupId: snap.id })),
      id: snap.id,
    }
  },
}

/** Split stored groups into the two flat arrays the screens read. */
export function splitModifierGroups(stored: StoredModifierGroup[]): {
  modifierGroups: ModifierGroup[]
  modifierOptions: ModifierOption[]
} {
  const modifierGroups: ModifierGroup[] = []
  const modifierOptions: ModifierOption[] = []
  for (const group of stored) {
    const { options, ...rest } = group
    modifierGroups.push(rest)
    modifierOptions.push(...options)
  }
  return { modifierGroups, modifierOptions }
}

/* ------------------------------- Settings ------------------------------ */

/** The settings document has no id of its own; its path is the identity. */
export const settingsConverter: FirestoreDataConverter<CafeSettings> = {
  toFirestore: (model: CafeSettings) => ({ ...model }),
  fromFirestore: (snap: QueryDocumentSnapshot): CafeSettings => {
    const { serverUpdatedAt: _s, ...data } = snap.data() as DocumentData & ServerFields
    return data as CafeSettings
  },
}

/* ------------------------------ Sequences ------------------------------ */

/**
 * The high-water mark for order and bill numbers.
 *
 * A device does not take one number at a time. It reserves a BLOCK in a
 * transaction while it is online, then hands numbers out of that block
 * locally — which is what lets the counter keep billing through a wifi drop,
 * since a Firestore transaction needs connectivity and a queued write does
 * not. See sequences.ts.
 */
export interface SequenceState {
  nextOrderNumber: number
  nextBillNumber: number
}

export const sequencesConverter: FirestoreDataConverter<SequenceState> = {
  toFirestore: (model: SequenceState) => ({ ...model }),
  fromFirestore: (snap: QueryDocumentSnapshot): SequenceState => {
    const data = snap.data() as DocumentData
    return {
      nextOrderNumber: Number(data.nextOrderNumber ?? 1),
      nextBillNumber: Number(data.nextBillNumber ?? 1),
    }
  },
}

/* ------------------------------- Devices ------------------------------- */

/**
 * One row per tablet or PC that has ever run the app for this outlet. Used
 * for the startup clock check and to show a manager which devices hold
 * reserved number blocks.
 */
export interface DeviceRecord {
  id: string
  label: string
  lastSeenAt: string
  lastSeenBy: string
  /** Written with serverTimestamp() so device clocks can be checked. */
  serverSeenAt?: Timestamp
  appVersion: string
}

export const deviceConverter: FirestoreDataConverter<DeviceRecord> = {
  toFirestore: (model: DeviceRecord) => stripId(model),
  fromFirestore: (snap: QueryDocumentSnapshot): DeviceRecord => {
    const data = snap.data() as DocumentData
    return { ...(data as Omit<DeviceRecord, 'id'>), id: snap.id }
  },
}
