//
//  LandingView.swift
//  MayaMind
//
//  Opening screen with Ken Burns slideshow of senior activity images
//

import SwiftUI

struct LandingView: View {
    let onEnter: () -> Void

    // Slideshow state - single index, no crossfade
    @State private var currentIndex = 0

    // Timer for auto-advancement
    @State private var timer: Timer?

    // Configuration
    private let slideDuration: Double = 8.0

    // Device-specific image sets (without extension)
    private let iPhoneImages = [
        "ben-iwara-GCcyCln2WjI-unsplash",
        "cecep-rahmat-OEKODwdge_g-unsplash",
        "intenza-fitness-8uzJGgJ1_3w-unsplash",
        "jonathan-borba-1-vyfxm-vUI-unsplash",
        "lara-john-UijIjarr5Gg-unsplash",
        "pexels-a-darmel-7322467",
        "pexels-askar-abayev-5638615",
        "pexels-fauxels-3184183",
        "pexels-runffwpu-8447272",
        "wlliam-zhou-D4M_odDQ59Q-unsplash"
    ]

    private let iPadImages = [
        "diana-light-uUMP9dXIm-o-unsplash",
        "pexels-mikhail-nilov-6975769",
        "kateryna-hliznitsova-PFzuNhy2dh8-unsplash",
        "getty-images-r_ftvGYIAlw-unsplash",
        "getty-images-fVnW1EkTJS0-unsplash",
        "getty-images-WTKMk6A-R5A-unsplash",
        "getty-images-hl1hcMT9A2s-unsplash",
        "getty-images--JDI6Z8GhUk-unsplash",
        "getty-images-LRorTPQTKt8-unsplash",
        "getty-images-l1FT4E7pfgw-unsplash"
    ]

    // Select images based on device
    private var imageNames: [String] {
        UIDevice.current.userInterfaceIdiom == .pad ? iPadImages : iPhoneImages
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Single slide with Ken Burns - instant cut on change
                slideView(geometry: geometry)

                // Dark overlay for text readability
                Color.black.opacity(0.3)

                // Branding overlay - right-justified in bottom area
                VStack {
                    Spacer()

                    // Branding content - right aligned
                    VStack(alignment: .trailing, spacing: 8) {
                        Text("MayaMind")
                            .font(.system(size: 44, weight: .bold))
                            .foregroundColor(.orange)
                            .fixedSize(horizontal: true, vertical: false)

                        Text("Your personal companion\nand exercise coach...")
                            .font(.system(size: 28, weight: .medium))
                            .foregroundColor(.white)
                            .multilineTextAlignment(.trailing)
                    }
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.trailing, 24)

                    Spacer()
                        .frame(height: geometry.size.height * 0.15)

                    // Tap to enter hint
                    VStack(spacing: 8) {
                        Image(systemName: "hand.tap.fill")
                            .font(.system(size: 24))
                            .foregroundColor(.white.opacity(0.7))

                        Text("Tap anywhere to begin")
                            .font(.system(size: 16))
                            .foregroundColor(.white.opacity(0.7))
                    }
                    .padding(.bottom, 40)
                }
            }
            .ignoresSafeArea()
        }
        .contentShape(Rectangle())
        .onTapGesture {
            enter()
        }
        .onAppear {
            startSlideshow()
        }
        .onDisappear {
            stopSlideshow()
        }
    }

    // MARK: - Slide View with Ken Burns Animation

    @ViewBuilder
    private func slideView(geometry: GeometryProxy) -> some View {
        // Load image from bundle
        if let image = loadImage(named: imageNames[currentIndex]) {
            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: .fill)
                .frame(width: geometry.size.width, height: geometry.size.height)
                .modifier(KenBurnsModifier(duration: slideDuration))
                .clipped()
                .id(currentIndex) // Force new view when index changes
        } else {
            // Fallback color if image not found
            Color(hex: "1a1a2e")
        }
    }

    // MARK: - Image Loading

    private func loadImage(named name: String) -> UIImage? {
        // Try loading from bundle resources directly
        if let path = Bundle.main.path(forResource: name, ofType: "jpg") {
            return UIImage(contentsOfFile: path)
        }
        // Try asset catalog (without extension)
        if let image = UIImage(named: name) {
            return image
        }
        // Try asset catalog (with extension)
        return UIImage(named: "\(name).jpg")
    }

    // MARK: - Slideshow Control

    private func startSlideshow() {
        currentIndex = 0

        timer = Timer.scheduledTimer(withTimeInterval: slideDuration, repeats: true) { _ in
            advanceSlide()
        }
    }

    private func stopSlideshow() {
        timer?.invalidate()
        timer = nil
    }

    private func advanceSlide() {
        // Instant cut to next slide (no crossfade)
        currentIndex = (currentIndex + 1) % imageNames.count
    }

    private func enter() {
        stopSlideshow()
        withAnimation(.easeOut(duration: 0.5)) {
            onEnter()
        }
    }
}

// MARK: - Ken Burns Animation Modifier

struct KenBurnsModifier: ViewModifier {
    let duration: Double

    @State private var scale: CGFloat = 1.0

    func body(content: Content) -> some View {
        content
            .scaleEffect(scale)
            .onAppear {
                // Simple slow zoom in for all images
                withAnimation(.linear(duration: duration)) {
                    scale = 1.15
                }
            }
    }
}

#Preview {
    LandingView(onEnter: {})
}
