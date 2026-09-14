import { collection, doc, type CollectionReference, type DocumentReference } from 'firebase/firestore'
import { firestore } from './app'
import {
  auditConverter,
  billConverter,
  staffIndexConverter,
  usernameClaimConverter,
  categoryConverter,
  customerConverter,
  deviceConverter,
  menuItemConverter,
  modifierGroupConverter,
  orderConverter,
  outletConverter,
  sequencesConverter,
  settingsConverter,
  staffConverter,
  stationConverter,
  tableConverter,
  walletEntryConverter,
} from './converters'
import type {
  AuditEntry,
  Bill,
  CafeSettings,
  CafeTable,
  Category,
  Customer,
  MenuItem,
  Order,
  Outlet,
  StaffIndexEntry,
  StaffMember,
  UsernameClaim,
  Station,
  WalletEntry,
} from '@/types'
import type { DeviceRecord, SequenceState, StoredModifierGroup } from './converters'

/**
 * Every reference the app uses, in one place, already carrying its converter.
 *
 * Nothing outside this file builds a Firestore path by hand. That is what
 * makes the multi-outlet layout safe: a query can only be written against
 * one outlet, because there is no way to name a collection without passing
 * an outletId.
 *
 *   /staffIndex/{uid}           which outlet a login belongs to. Outside any
 *                               outlet, because a fresh browser has to read
 *                               it BEFORE it knows which outlet path it is
 *                               allowed to look in.
 *   /usernames/{username}       a claimed username, so a clash is found
 *                               before an auth account is created for it.
 *
 *   /outlets/{outletId}
 *     /staff/{uid}              one row per login; the doc id IS the auth uid.
 *                               Also the source of truth for their role.
 *     /stations/{id}
 *     /categories/{id}
 *     /items/{id}
 *     /modifierGroups/{id}      options nested inside the group document
 *     /tables/{id}
 *     /orders/{id}              filtered by businessDate and status
 *     /bills/{id}               filtered by businessDate
 *     /customers/{id}           id is the 10-digit mobile number
 *     /walletEntries/{id}       flat, with customerId + businessDate
 *     /auditLog/{id}            append only
 *     /devices/{deviceId}       clock check and sequence block ownership
 *     /meta/settings            the single CafeSettings document
 *     /meta/sequences           order and bill number allocation
 */

export const OUTLETS = 'outlets'
export const STAFF_INDEX = 'staffIndex'
export const USERNAMES = 'usernames'

/**
 * A claimed username. Keyed by the username so "is this taken" is one get by
 * id rather than a query, and so two managers cannot claim the same one.
 */
export function usernameRef(username: string): DocumentReference<UsernameClaim> {
  return doc(firestore, USERNAMES, username).withConverter(usernameClaimConverter)
}

/**
 * Which outlet a uid belongs to. Readable only by that uid, writable only by
 * a manager of the outlet it names. Deliberately tiny: it holds no role, so
 * a leaked read tells an attacker nothing they can use.
 */
export function staffIndexRef(uid: string): DocumentReference<StaffIndexEntry> {
  return doc(firestore, STAFF_INDEX, uid).withConverter(staffIndexConverter)
}

export function outletRef(outletId: string): DocumentReference<Outlet> {
  return doc(firestore, OUTLETS, outletId).withConverter(outletConverter)
}

function sub(outletId: string, name: string) {
  return collection(firestore, OUTLETS, outletId, name)
}

export function staffCol(outletId: string): CollectionReference<StaffMember> {
  return sub(outletId, 'staff').withConverter(staffConverter)
}
export function staffRef(outletId: string, uid: string): DocumentReference<StaffMember> {
  return doc(firestore, OUTLETS, outletId, 'staff', uid).withConverter(staffConverter)
}

export function stationsCol(outletId: string): CollectionReference<Station> {
  return sub(outletId, 'stations').withConverter(stationConverter)
}
export function stationRef(outletId: string, id: string): DocumentReference<Station> {
  return doc(firestore, OUTLETS, outletId, 'stations', id).withConverter(stationConverter)
}

export function categoriesCol(outletId: string): CollectionReference<Category> {
  return sub(outletId, 'categories').withConverter(categoryConverter)
}
export function categoryRef(outletId: string, id: string): DocumentReference<Category> {
  return doc(firestore, OUTLETS, outletId, 'categories', id).withConverter(categoryConverter)
}

export function itemsCol(outletId: string): CollectionReference<MenuItem> {
  return sub(outletId, 'items').withConverter(menuItemConverter)
}
export function itemRef(outletId: string, id: string): DocumentReference<MenuItem> {
  return doc(firestore, OUTLETS, outletId, 'items', id).withConverter(menuItemConverter)
}

export function modifierGroupsCol(outletId: string): CollectionReference<StoredModifierGroup> {
  return sub(outletId, 'modifierGroups').withConverter(modifierGroupConverter)
}
export function modifierGroupRef(
  outletId: string,
  id: string,
): DocumentReference<StoredModifierGroup> {
  return doc(firestore, OUTLETS, outletId, 'modifierGroups', id).withConverter(modifierGroupConverter)
}

export function tablesCol(outletId: string): CollectionReference<CafeTable> {
  return sub(outletId, 'tables').withConverter(tableConverter)
}
export function tableRef(outletId: string, id: string): DocumentReference<CafeTable> {
  return doc(firestore, OUTLETS, outletId, 'tables', id).withConverter(tableConverter)
}

export function ordersCol(outletId: string): CollectionReference<Order> {
  return sub(outletId, 'orders').withConverter(orderConverter)
}
export function orderRef(outletId: string, id: string): DocumentReference<Order> {
  return doc(firestore, OUTLETS, outletId, 'orders', id).withConverter(orderConverter)
}

export function billsCol(outletId: string): CollectionReference<Bill> {
  return sub(outletId, 'bills').withConverter(billConverter)
}
export function billRef(outletId: string, id: string): DocumentReference<Bill> {
  return doc(firestore, OUTLETS, outletId, 'bills', id).withConverter(billConverter)
}

export function customersCol(outletId: string): CollectionReference<Customer> {
  return sub(outletId, 'customers').withConverter(customerConverter)
}
/** The document id IS the 10-digit phone, so a lookup is one get, not a query. */
export function customerRef(outletId: string, phone: string): DocumentReference<Customer> {
  return doc(firestore, OUTLETS, outletId, 'customers', phone).withConverter(customerConverter)
}

export function walletEntriesCol(outletId: string): CollectionReference<WalletEntry> {
  return sub(outletId, 'walletEntries').withConverter(walletEntryConverter)
}
export function walletEntryRef(outletId: string, id: string): DocumentReference<WalletEntry> {
  return doc(firestore, OUTLETS, outletId, 'walletEntries', id).withConverter(walletEntryConverter)
}

export function auditCol(outletId: string): CollectionReference<AuditEntry> {
  return sub(outletId, 'auditLog').withConverter(auditConverter)
}
export function auditRef(outletId: string, id: string): DocumentReference<AuditEntry> {
  return doc(firestore, OUTLETS, outletId, 'auditLog', id).withConverter(auditConverter)
}

export function devicesCol(outletId: string): CollectionReference<DeviceRecord> {
  return sub(outletId, 'devices').withConverter(deviceConverter)
}
export function deviceRef(outletId: string, deviceId: string): DocumentReference<DeviceRecord> {
  return doc(firestore, OUTLETS, outletId, 'devices', deviceId).withConverter(deviceConverter)
}

export function settingsRef(outletId: string): DocumentReference<CafeSettings> {
  return doc(firestore, OUTLETS, outletId, 'meta', 'settings').withConverter(settingsConverter)
}

export function sequencesRef(outletId: string): DocumentReference<SequenceState> {
  return doc(firestore, OUTLETS, outletId, 'meta', 'sequences').withConverter(sequencesConverter)
}
