{
  description = "Closed-loop fly: a sensorimotor loop through the male Drosophila connectome, in the browser";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));
    in
    {
      packages = forAll (pkgs:
        let
          assets = import ./nix/assets.nix { inherit (pkgs) fetchurl; };
          # Put every fixed-output asset where the vendored trees expect it (replaces LFS pointers).
          placeAssets = ''
            ${pkgs.lib.concatMapStrings (a: ''
              install -Dm644 ${a.src} vendor/fruit-fly-simulation/${a.path}
            '') assets.xenova}
            ${pkgs.lib.concatMapStrings (a: ''
              install -Dm644 ${a.src} vendor/fruit-fly-brain/${a.path}
            '') assets.abijah}
          '';
        in
        rec {
          # The static site (Xenova's demo booted from this repo, with the inject/rates worker).
          # Pure: npm deps by hash, data by hash, no network. Build with submodules:
          #   nix build '.?submodules=1'
          default = pkgs.buildNpmPackage {
            pname = "closed-loop-fly";
            version = "0.0.0";
            src = self;
            npmDepsHash = pkgs.lib.fileContents ./nix/npm-deps-hash;
            postPatch = ''
              [ -f vendor/fruit-fly-simulation/package.json ] || { echo "submodules missing: build with nix build '.?submodules=1'"; exit 1; }
              ${placeAssets}
            '';
            npmBuildScript = "vite:build"; # plain `vite build`; the user-facing scripts wrap `nix develop`
            installPhase = ''
              runHook preInstall
              cp -r dist $out
              runHook postInstall
            '';
            # vite 8 ships prebuilt native bindings (rolldown); nothing to compile.
            dontNpmInstall = true;
          };
          # The MaleCNS annotation table, verified (fixed-output).
          annotations = assets.annotations;
          # All LFS-backed assets as a tree, for machines without git-lfs:
          #   cp -r $(nix build .#assets --print-out-paths)/vendor/. vendor/
          assets = pkgs.runCommand "closed-loop-fly-assets" { } ''
            mkdir -p $out && cd $out
            ${placeAssets}
          '';
        });

      devShells = forAll (pkgs:
        let
          assets = import ./nix/assets.nix { inherit (pkgs) fetchurl; };
          python = pkgs.python3.withPackages (ps: [ ps.pyarrow ps.pandas ]);
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22 # >= 22.12, what Xenova's package.json asks for
              pkgs.git
              pkgs.git-lfs
              pkgs.rsync
              pkgs.openssh
              pkgs.prefetch-npm-deps # to refresh nix/npm-deps-hash after package-lock.json changes
              python
            ];
            # The annotation table comes from the store, never from an ad-hoc download.
            MALECNS_ANNOTATIONS = assets.annotations;
            shellHook = ''
              # GPU work (bench/browser.mjs, npm run dev with WebGPU) uses the HOST's Brave and
              # NVIDIA Vulkan driver on purpose: neither is packaged here. Warn now, fail there.
              missing=""
              command -v brave >/dev/null 2>&1 || missing="$missing brave"
              command -v vulkaninfo >/dev/null 2>&1 || missing="$missing vulkaninfo"
              if [ -n "$missing" ]; then
                echo "closed-loop-fly: GPU tools not on PATH:$missing — CPU benches work; bench/browser.mjs and WebGPU will not (needs Brave + host Vulkan driver, see DECISIONS.md)" >&2
              fi
              export CLF_GPU_TOOLS_MISSING="$missing"
            '';
          };
        });
    };
}
