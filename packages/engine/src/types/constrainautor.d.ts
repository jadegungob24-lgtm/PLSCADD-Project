/**
 * Type declarations for @kninnug/constrainautor. The package ships its
 * TypeScript source as its typings, which does not compile under this
 * project's strict options, so tsconfig "paths" points here instead.
 */
export interface DelaunatorLike {
  coords: ArrayLike<number>;
  triangles: Uint32Array | Int32Array;
  halfedges: Int32Array;
  hull: Uint32Array | Int32Array;
}

export default class Constrainautor {
  constructor(del: DelaunatorLike, edges?: readonly [number, number][]);
  /** Forces an edge between two point indices; throws if it cannot be enforced. */
  constrainOne(segP1: number, segP2: number): number;
  constrainAll(edges: readonly [number, number][]): DelaunatorLike;
  delaunify(deep?: boolean): this;
}
