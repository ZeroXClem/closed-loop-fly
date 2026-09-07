{
  description = "Closed-loop fly: a sensorimotor loop through the male Drosophila connectome, in the browser";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # The vendored upstreams, pinned to the same commits as the git submodules under vendor/
    # (scripts/check-pins.sh verifies). Declared here so `nix build .` needs neither
    # `?submodules=1` nor git-lfs: LFS objects arrive as pointers and nix/assets.nix overlays them.
    xenova = { url = "git+https://huggingface.co/spaces/Xenova/fruit-fly-simulation?ref=main&rev=776d115ee5aa934578a87fd6d260d138084f59c1"; flake = false; };
    abijah-research = { url = "github:AbijahKaj/fruit-fly-brain-research/c28066a5b9eff03efdb002f6779980d29f70634c"; flake = false; };
    abijah-data = { url = "git+https://huggingface.co/AbijahKaj/fruit-fly-brain?ref=main&rev=4893ecff295a9972db0480bcd24458c958387bd8"; flake = false; };
  };

  outputs = { self, nixpkgs, xenova, abijah-research, abijah-data }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));
    in
    {
      packages = forAll (pkgs:
        let
          assets = import ./nix/assets.nix { inherit (pkgs) fetchurl; };
          # Assemble vendor/ from the pinned inputs, then put every fixed-output asset where the
          # trees expect it (replacing the LFS pointer files).
          placeVendor = ''
            rm -rf vendor && mkdir -p vendor
            cp -r ${xenova} vendor/fruit-fly-simulation
            cp -r ${abijah-research} vendor/fruit-fly-brain-research
            cp -r ${abijah-data} vendor/fruit-fly-brain
            chmod -R u+w vendor
          '';
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
          # Pure: npm deps by hash, upstream trees by rev, data by hash, no network:  nix build .
          default = pkgs.buildNpmPackage {
            pname = "closed-loop-fly";
            version = "0.0.0";
            src = self;
            npmDepsHash = pkgs.lib.fileContents ./nix/npm-deps-hash;
            postPatch = ''
              ${placeVendor}
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
          # All LFS-backed assets as a tree, for checkouts without git-lfs:
          #   cp -r $(nix build .#assets --print-out-paths)/vendor/. vendor/
          assets = pkgs.runCommand "closed-loop-fly-assets" { } ''
            mkdir -p $out && cd $out
            ${placeAssets}
          '';
          # The three upstream trees exactly as the build sees them (LFS pointers included).
          vendor = pkgs.runCommand "closed-loop-fly-vendor" { } ''
            mkdir -p $out && cd $out
            ${placeVendor}
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
              # mkShell replaces XDG_DATA_DIRS with store paths; the host Vulkan loader then
              # cannot find /usr/share/vulkan/icd.d (nvidia_icd.json) and reports no drivers.
              # Put the host directories back so Brave and vulkaninfo see the NVIDIA driver.
              export XDG_DATA_DIRS="''${XDG_DATA_DIRS:+$XDG_DATA_DIRS:}/usr/local/share:/usr/share"
              export XDG_CONFIG_DIRS="''${XDG_CONFIG_DIRS:+$XDG_CONFIG_DIRS:}/etc/xdg"
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
