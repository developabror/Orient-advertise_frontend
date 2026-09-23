import { useEffect, useState } from 'react';
import axios from 'axios';
import { extractApiMessage, getDeviceActivePlaylist, type DeviceActivePlaylist } from '@api';
import { markErrorHandled } from '@api/errorDialog';

/**
 * The device's current playlist for the detail page's panel.
 *
 * Its own hook (not part of `useDevice`) because it is a separate endpoint with
 * a separate failure mode: the device record can load while the playlist call
 * fails. The old code folded the two together and swallowed the failure with
 * `.catch(() => null)`, which is why every device page silently claimed "No
 * playlist assigned" (VG-02) — an error must reach the operator, so it is kept
 * here as a state the panel renders.
 */
export type DeviceActivePlaylistState =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly playlist: DeviceActivePlaylist | null }
  | { readonly state: 'error'; readonly message: string | null };

export const useDeviceActivePlaylist = (id: string | undefined): DeviceActivePlaylistState => {
  const [state, setState] = useState<DeviceActivePlaylistState>({ state: 'loading' });

  useEffect(() => {
    if (!id) {
      setState({ state: 'ready', playlist: null });
      return;
    }
    setState({ state: 'loading' });

    let cancelled = false;
    const controller = new AbortController();

    getDeviceActivePlaylist(id, controller.signal)
      .then((playlist) => {
        if (cancelled) return;
        // `playlistId: null` is the backend's "nothing assigned" — a normal
        // state the panel words for the operator, not an error.
        setState({ state: 'ready', playlist: playlist.playlistId === null ? null : playlist });
      })
      .catch((err: unknown) => {
        if (cancelled || axios.isCancel(err)) return;
        // The panel shows the message, so claim the deferred error dialog.
        markErrorHandled(err);
        setState({ state: 'error', message: extractApiMessage(err) });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id]);

  return state;
};
