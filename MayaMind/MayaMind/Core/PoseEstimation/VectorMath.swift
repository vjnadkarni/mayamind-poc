//
//  VectorMath.swift
//  MayaMind
//
//  Vector math utilities for joint angle calculations.
//  Ported from exercise-poc/utils.js
//

import Foundation
import simd

/// 3D point structure for landmarks
struct Point3D {
    var x: Float
    var y: Float
    var z: Float
    var visibility: Float

    init(x: Float, y: Float, z: Float, visibility: Float = 1.0) {
        self.x = x
        self.y = y
        self.z = z
        self.visibility = visibility
    }

    /// Convert to simd vector for efficient math
    var simd: SIMD3<Float> {
        SIMD3(x, y, z)
    }
}

/// Vector math utilities
enum VectorMath {

    /// Subtract two 3D points: a - b
    static func subtract(_ a: Point3D, _ b: Point3D) -> SIMD3<Float> {
        return a.simd - b.simd
    }

    /// Dot product of two 3D vectors
    static func dot(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> Float {
        return simd_dot(a, b)
    }

    /// Magnitude (length) of a 3D vector
    static func magnitude(_ v: SIMD3<Float>) -> Float {
        return simd_length(v)
    }

    /// Calculate angle at vertex B formed by points A-B-C (in degrees)
    ///
    /// This computes the angle ABC where B is the vertex (joint).
    /// Uses the dot product formula: cos(theta) = (BA . BC) / (|BA| x |BC|)
    ///
    /// - Parameters:
    ///   - a: First point (e.g., hip)
    ///   - b: Vertex/joint (e.g., knee)
    ///   - c: Third point (e.g., ankle)
    /// - Returns: Angle in degrees (0-180)
    static func angleBetweenPoints(_ a: Point3D, _ b: Point3D, _ c: Point3D) -> Float {
        let ba = subtract(a, b)
        let bc = subtract(c, b)

        let dotProduct = dot(ba, bc)
        let magBA = magnitude(ba)
        let magBC = magnitude(bc)

        // Avoid division by zero
        guard magBA > 0 && magBC > 0 else { return 0 }

        // Clamp to [-1, 1] to handle floating point errors
        let cosAngle = max(-1, min(1, dotProduct / (magBA * magBC)))

        // Convert to degrees
        let angleRad = acos(cosAngle)
        return angleRad * (180 / .pi)
    }

    /// Simple exponential moving average smoother
    ///
    /// - Parameters:
    ///   - newValue: New incoming value
    ///   - prevSmoothed: Previous smoothed value
    ///   - alpha: Smoothing factor (0-1). Lower = more smoothing.
    /// - Returns: Smoothed value
    static func exponentialSmooth(_ newValue: Float, _ prevSmoothed: Float?, alpha: Float = 0.3) -> Float {
        guard let prev = prevSmoothed, !prev.isNaN else {
            return newValue
        }
        return alpha * newValue + (1 - alpha) * prev
    }

    /// Check if a landmark has sufficient visibility/confidence
    ///
    /// - Parameters:
    ///   - visibility: Visibility score (0-1)
    ///   - threshold: Minimum visibility threshold
    /// - Returns: True if visible enough
    static func isLandmarkVisible(_ visibility: Float, threshold: Float = 0.5) -> Bool {
        return visibility >= threshold
    }
}
