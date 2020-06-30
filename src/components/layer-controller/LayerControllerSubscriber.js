import React, { useState, useEffect, useCallback } from 'react';

import PubSub from 'pubsub-js';
import Grid from '@material-ui/core/Grid';
import {
  ThemeProvider, StylesProvider,
  createGenerateClassName,
} from '@material-ui/core/styles';
import { createZarrLoader, createOMETiffLoader } from '@hubmap/vitessce-image-viewer';

import TitleInfo from '../TitleInfo';
import LayerController from './LayerController';
import ImageAddButton from './ImageAddButton';
import {
  RASTER_ADD,
  LAYER_REMOVE,
  CLEAR_PLEASE_WAIT,
  METADATA_REMOVE,
  METADATA_CLEAR,
  LAYER_ADD,
  METADATA_ADD,
} from '../../events';
import { controllerTheme } from './styles';
import { DEFAULT_LAYER_PROPS } from './constants';

const generateClassName = createGenerateClassName({
  disableGlobal: true,
});

function genId() {
  return String(Math.random());
}

async function initLoader(imageData) {
  const {
    type, url, metadata, requestInit,
  } = imageData;
  switch (type) {
    case ('zarr'): {
      const { dimensions, isPyramid, transform } = metadata;
      const { scale = 0, translate = { x: 0, y: 0 } } = transform;
      const loader = await createZarrLoader({
        url, dimensions, isPyramid, scale, translate,
      });
      return loader;
    }
    case ('ome-tiff'): {
      // Fetch offsets for ome-tiff if needed.
      if ('omeTiffOffsetsUrl' in metadata) {
        const { omeTiffOffsetsUrl } = metadata;
        const res = await fetch(omeTiffOffsetsUrl, requestInit);
        if (res.ok) {
          const offsets = await res.json();
          const loader = await createOMETiffLoader({
            url,
            offsets,
            headers: requestInit,
          });
          return loader;
        }
        throw new Error('Offsets not found but provided.');
      }
      const loader = createOMETiffLoader({
        url,
        headers: requestInit,
      });
      return loader;
    }
    default: {
      throw Error(`Image type (${type}) is not supported`);
    }
  }
}

function publishLayer({ loader, imageData, layerId }) {
  PubSub.publish(LAYER_ADD, {
    layerId,
    loader,
    layerProps: DEFAULT_LAYER_PROPS,
  });
  if (loader.getMetadata) {
    PubSub.publish(METADATA_ADD, {
      layerId,
      layerName: imageData.name,
      layerMetadata: loader.getMetadata(),
    });
  }
}

function LayerControllerSubscriber({ onReady, removeGridComponent, theme }) {
  const [imageOptions, setImageOptions] = useState(null);
  const [layersAndLoaders, setLayersAndLoaders] = useState([]);
  const memoizedOnReady = useCallback(onReady, []);

  useEffect(() => {
    async function handleRasterAdd(msg, raster) {
      // render_layers provides the order for rendering initially.
      const { images, renderLayers } = raster;
      setImageOptions(images);
      // Clear the metadata out when a new `RASTER_ADD` event is detected
      PubSub.publish(METADATA_CLEAR);
      if (!renderLayers) {
        const layerId = genId();
        // Midpoint of images list as default image to show.
        const imageData = images[Math.floor(images.length / 2)];
        const loader = await initLoader(imageData);
        publishLayer({ loader, imageData, layerId });
        setLayersAndLoaders([{ layerId, imageData, loader }]);
      } else {
        const newLayersAndLoaders = await Promise.all(renderLayers.map(async (imageName) => {
          const layerId = genId();
          const [imageData] = images.filter(image => image.name === imageName);
          const loader = await initLoader(imageData);
          return { layerId, imageData, loader };
        }));
        newLayersAndLoaders.forEach(({ imageData, loader, layerId: id }) => {
          publishLayer({ loader, imageData, layerId: id });
        });
        setLayersAndLoaders(newLayersAndLoaders);
      }
      PubSub.publish(CLEAR_PLEASE_WAIT, 'raster');
    }
    memoizedOnReady();
    const token = PubSub.subscribe(RASTER_ADD, handleRasterAdd);
    return () => PubSub.unsubscribe(token);
  }, [memoizedOnReady]);

  const handleImageAdd = async (imageData) => {
    const layerId = genId();
    const loader = await initLoader(imageData);
    publishLayer({ loader, imageData, layerId });
    setLayersAndLoaders(prevState => [...prevState, { layerId, imageData, loader }]);
  };

  const handleLayerRemove = (layerId, layerName) => {
    const nextLayersAndLoaders = layersAndLoaders.filter(d => d.layerId !== layerId);
    setLayersAndLoaders(nextLayersAndLoaders);
    PubSub.publish(LAYER_REMOVE, layerId);
    PubSub.publish(METADATA_REMOVE, { layerId, layerName });
  };
  const layerControllers = layersAndLoaders.map(({ layerId, imageData, loader }) => (
    <Grid key={layerId} item style={{ marginTop: '10px' }}>
      <LayerController
        layerId={layerId}
        imageData={imageData}
        handleLayerRemove={() => handleLayerRemove(layerId, imageData.name)}
        loader={loader}
        theme={theme}
      />
    </Grid>
  ));
  return (
    <TitleInfo
      title="Layer Controller"
      isScroll
      removeGridComponent={removeGridComponent}
    >
      <StylesProvider generateClassName={generateClassName}>
        <ThemeProvider theme={controllerTheme[theme]}>
          {layerControllers}
          <Grid item>
            <ImageAddButton
              imageOptions={imageOptions}
              handleImageAdd={handleImageAdd}
            />
          </Grid>
        </ThemeProvider>
      </StylesProvider>
    </TitleInfo>
  );
}

export default LayerControllerSubscriber;
