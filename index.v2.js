
(function (doc, async) {
    'use strict';
    function MapApp(options) {
        this.options = extend(Object.create(this.options), options);
        //点标注类型 
        this.markerType = {
            big: 1,
            small: 2
        };
        //身边事类型 
        this.momentsType = {
            moment: 1,
            store: 2
        };
        //地图操作类型
        this.mapActionType = {
            pan: 0,
            zoomIn: 1,
            zoomOut: 2,
            rotate: 3
        };

        //第三方地图瓦片
        this.squareTiles = {
            mapboxTile: 'https://a.tiles.mapbox.com/v4/yangkun2197.fe4acfe1/[z]/[x]/[y].png?access_token=pk.eyJ1IjoieWFuZ2t1bjIxOTciLCJhIjoiY2lsMGticzJoMXhldXZ5bTMxZWV0cmM3bSJ9.-5ha59jF4piqojH4muYP9g',
            osmTile: 'http://a.tile.osm.org/[z]/[x]/[y].png',
            mapboxLightTile: 'https://api.tiles.mapbox.com/v4/mapbox.light/[z]/[x]/[y].png?access_token=pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpandmbXliNDBjZWd2M2x6bDk3c2ZtOTkifQ._QA7i5Mpkd_m30IGElHziw',
            googleTile: 'http://mt{1,2,3,0}.google.cn/vt/lyrs=m@142&hl=zh-CN&gl=cn&x=[x]&y=[y]&z=[z]&s=Galil',
            skobblerTile: 'http://tiles2-bc7b4da77e971c12cb0e069bffcf2771.skobblermaps.com/TileService/tiles/2.0/01021113210/7/[z]/[x]/[y].png'

        };
        //与后台线程通讯的消息类型
        this.messageActionType = {
            saved: 1,//表示聚合运算后（即数据存储到R树后）返回
            searched: 2//表示查找R树后返回
        };

        this.mapObj = null;  //地图对象  
        this.infoWindow = null;//地图上的弹窗
        this.worker = null; //地图数据后台服务   用于管理R树，如查询，存储等

        this.markersInMap = [];//存放地图上已经加载的点
        this.gridLoaded = []//存储加载过的网格   

        this.lastZoom = 12;//上次地图缩放比例
        this.lastMapAction = null;//this.mapActionType.pan  上次地图操作行为
        //格子管理器
        this.tileGridManager = null;//new TileGrid()
        this.ready = false;//地图数据是否加载完成
        this.firstLoad = false;//是否是第一次加载数据  


        //this.squareTile =null;//第三方瓦片  
    };

    MapApp.prototype = {
        options: {
            mapId: 'map',//地图渲染DomId
            //云搜索设置
            
            yunSearch_maxPage: 40,
            yunSearch_yunTableId: '56a0c117305a2a32882244b1',   // 云图 表格Id
            yunSearch_opt_keywords: '',
            yunSearch_opt_filter: 'DataStatus:2',
            //filter:'Column:[3,5]+Row:[3,5]',
            yunSearch_opt_pageSize: 100,//  每页请求高德数量
            yunSearch_opt_orderBy: '_id:ASC',
            //yunSearch_opt_pageIndex: 0,

            //countryZoom: 7,  // 缩放级别 小于 7级为查询全国数据
            defaultZoom: 12, //   默认缩放比例
            defaultCenter: [121.380859, 31.188998],//默认地图中心点  上海
            cityGridSpace: 2,    //城市格子占用经纬度 默认2度
            openSquareTile: false,//是否启用第三方瓦片
            squareTileUrl: null,//第三方瓦片地址
            minMarkerImage: 'images/marker-icon-min.png',//地图小点图片地址
            log: false,   //   是否显示日志
            apiUrl: 'http://193.168.5.144:8081'
        },
        //设置第三方瓦片图源
        squareTile: function (tileUrl) {
            var $self = this;
            //this.options.openSquareTile = true;
            $self.mapObj.setFeatures(['']);
            $self.mapObj.setMapStyle('');
            var tmpLayer = new AMap.TileLayer({
                tileUrl: tileUrl || $self.squareTiles.mapboxTile  // 图块取图地址
            });
            tmpLayer.setMap($self.mapObj);
        },
        //地图初始化
        init: function () {
            var $self = this;
            var log = $self.options.log;
            //初始化格子管理器
            $self.tileGridManager = new TileGrid($self.options.cityGridSpace);

            //初始化后台服务
            $self._initWorker('worker.v2.js');

            //初始化地图对象
            $self.mapObj = new AMap.Map($self.options.mapId, {
                center: new AMap.LngLat($self.options.defaultCenter[0], $self.options.defaultCenter[1]), //地图中心点   上海
                //center: new AMap.LngLat(120.064308, 30.18318), //地图中心点      杭州
                level: $self.options.defaultZoom  //地图显示的比例尺级别  
            });


            //初始化皮肤 加载POI数据
            setTimeout(function () {
                if ($self.options.openSquareTile) {
                    $self.mapObj.setFeatures(['']);
                    //$self.mapObj.setMapStyle('');
                    var tmpLayer = new AMap.TileLayer({
                        zIndex: 2,
                        tileUrl: $self.options.squareTileUrl || $self.squareTiles.mapboxTile  // 图块取图地址
                    });
                    tmpLayer.setMap($self.mapObj);
                } else {
                    $self.mapObj.setFeatures(['bg', 'road']);//
                    $self.mapObj.setMapStyle('blue_night');
                }

                $self._cloudSearch();
            }, 300);
            //初始化地图事件
            $self._initMapHandler();

            setTimeout(function () {
                $self._updateMap();
            }, 3000);
        },
        cloudSearch: function () {
            var $self = this;
            var log = $self.options.log;
            if (log) console.log('初始化时发起请求 查询高德云图数据：');
            $self._cloudSearch();
        },
        //初始化地图事件
        _initMapHandler: function () {
            var $self = this;
            var log = $self.options.log;

            //初始化地图事件
            $self.mapObj.on('moveend', function () {

                var curZoom = $self.mapObj.getZoom();
                if (curZoom == $self.lastZoom) {
                    //如果地图操作后 缩放比例相同  ，地图刚刚进行了平移或旋转操作
                    $self.lastMapAction = $self.mapActionType.pan;
                    if (log) console.log('map moveend 缩放比例：' + curZoom + '，地图刚刚进行了平移操作');
                } else if (curZoom > $self.lastZoom) {
                    //如果地图操作后 缩放比例>上次缩放比例  ，地图刚刚进行了放大操作
                    $self.lastMapAction = $self.mapActionType.zoomIn;
  
                    if (log) console.log('map moveend 缩放比例：' + curZoom + '，地图刚刚进行了放大操作');


                } else {
                    //如果地图操作后 缩放比例<上次缩放比例  ，地图刚刚进行了缩小操作  
                    $self.lastMapAction = $self.mapActionType.zoomOut;
                    //缩小操作后，清空地图上的数据
                    $self.markersInMap = [];
                    if (log) console.log('map moveend 缩放比例：' + curZoom + '，地图刚刚进行了缩小操作');
                }
                $self.lastZoom = curZoom;

                //更新地图上的标注
                $self._updateMap();

                //请求高德云数据
                $self._cloudSearch();
            });
        },
        updateMap: function (params) {
            this._updateMap();
        },
        //更新地图标注
        _updateMap: function () {
            var $self = this;
            var log = $self.options.log;
            //如果地图数据还没有加载好，则直接返回
            if (!$self.ready) return;

            //获取当前视窗以及缩放比例
            var bounds = $self.mapObj.getBounds();
            var zoom = $self.mapObj.getZoom();

            var data = {
                //传入的点 为 西南   东北 
                bbox: [bounds.getSouthWest().getLng(), bounds.getSouthWest().getLat(), bounds.getNorthEast().getLng(), bounds.getNorthEast().getLat()],
                zoom: zoom
            };
            if (log) console.log('更新地图标注' + JSON.stringify(data));

            //传入的点 为 西北 东南
            var grids = $self.tileGridManager.getGridByBounds(data.bbox[0], data.bbox[3], data.bbox[1], data.bbox[2], zoom);

            //var shgrids = tileGridManager.getGridByPoint(121.380859, 31.188998); 
            //drawGridPolygon([shgrids]);  

            //向worker发送指令  搜索地图数据
            $self.worker.postMessage({
                actionType: $self.messageActionType.searched,
                bbox: data.bbox,
                zoom: data.zoom,
                markerInMap: $self.markersInMap.map(function (el) {
                    return {
                        position: el.position,
                        extData: el.extData,
                    };
                }),//传输 地图上已经有的点，方便后台过滤数据
                cityCodes: grids.map(function (el) { return el.gridNo })
            });
        },
        //云搜索  
        _cloudSearch: function () {
            ///todo  加载过的POI格子数据， 按照时间区分版本，每次移动或者缩放的时候， 调用查询周边接口，补充本地的POI数据（增加一个搜索条件，就是 时间版本）
            var $self = this;
            var log = $self.options.log;

            var grid;//定义查询格子范围
            var zoom = $self.mapObj.getZoom();

            //POI数据  
            var center = $self.mapObj.getCenter();
            grid = $self.tileGridManager.getGridByPoint(center.lng, center.lat, zoom);

            if (log) console.log('已加载网格：' + JSON.stringify($self.gridLoaded));
            //如果该格子数据已经加载过了，则退出本次查询
            if ($self.gridLoaded.indexOf(grid.gridNo) > -1) {
                if (log) console.log('网格：' + grid.gridNo + '的数据，已经从高德加载过，退出本次云搜索');
                return false;
            } else {
                $self.gridLoaded.push(grid.gridNo);
            }

            var search;

            var searchOptions = {
                keywords: $self.options.yunSearch_opt_keywords,
                filter: $self.options.yunSearch_opt_filter,
                //filter:'Column:[3,5]+Row:[3,5]',
                pageSize: $self.options.yunSearch_opt_pageSize,//  每页请求高德数量
                orderBy: $self.options.yunSearch_opt_orderBy,
                pageIndex: 0
            };
            var tempMaxPage = $self.options.yunSearch_maxPage;
            if (zoom < 5) { tempMaxPage = 5; }
            if (zoom < 8) { tempMaxPage = 10; }

            var items = [];
            for (var i = 0; i <= tempMaxPage; i++) {
                items.push(i);
            }
            if (log) console.log('查询高德云图数据 ' + JSON.stringify(grid));

            async.map(items, function (item, callback) {
                searchOptions.pageIndex = item;
                search = new AMap.CloudDataSearch($self.options.yunSearch_yunTableId, searchOptions); //构造云数据检索类  

                search.searchInPolygon([[grid.lng, grid.lat], [grid.lng2, grid.lat2]], function (status, data) {
                    callback(null, { status: status, data: data });
                });  //矩形区域搜索

            }, function (err, results) {
                var tmpDatas = [];
                results.forEach(function (el) {
                    if (el.status == 'complete') {
                        tmpDatas = tmpDatas.concat(el.data.datas);
                    }
                });
                var trees = tmpDatas.map(function (p) {
                    return {
                        type: 'Feature',
                        properties: {
                            "pointId": p._id,
                            "pic": p.PicFile_256,
                            "commentCount": p.CommentCount,
                            "userId": p.UserId,
                            "weighting": p.Weighting,//权重
                            "name": p._name,
                            "popupContent": p._name,
                            "dataId": p.DataId,
                            "address": p._address,
                            'momentType': p.MomentType,
                            'nickName': p.UserNickName
                        },
                        geometry: {
                            type: 'Point',
                            coordinates: [p._location.lng, p._location.lat] //coordinates: [p._location.lng + D_LONGITUDE, p._location.lat + D_LATITUDE]
                        }
                    };
                });
                if (log) console.log('得到高德云图数据 ' + JSON.stringify(grid) + '：共' + trees.length + '条');

                //告诉worker重新做一次聚合
                $self.worker.postMessage({
                    actionType: $self.messageActionType.saved,
                    loadTrees: trees,
                    cityCode: grid.gridNo
                });
            });
        },
        //在指定位置打开信息窗体
        _openWindowInfo: function (feature) {
            var $self = this;
            //构建信息窗体中显示的内容
            var info = '';
            var imgName = '';
            var address = '';
            var userId = '';
            var popupContent = '';
            var weighting = '';
            var momentId = '';
            var momentType = '';
            var nickName = '';

            if (feature.properties.cluster) {
                imgName = feature.properties.wPoint.pic;
                userId = feature.properties.wPoint.userId;
                address = feature.properties.wPoint.address;
                popupContent = feature.properties.wPoint.popupContent;
                weighting = feature.properties.wPoint.weighting;
                momentId = feature.properties.wPoint.dataId;
                momentType = feature.properties.wPoint.momentType;

                nickName = feature.properties.wPoint.nickName;
            } else {
                imgName = feature.properties.pic;
                userId = feature.properties.userId;
                address = feature.properties.address;
                popupContent = feature.properties.popupContent;
                weighting = feature.properties.weighting;
                momentId = feature.properties.dataId;
                momentType = feature.properties.momentType;
                nickName = feature.properties.nickName;
            }
 
			var imgUrl = 'images/8.jpg';
            var linkUrl = "javascript:;"; 

            info = ['<div class="infobox idle">'
                , '<div class="left">'
                , '  <a href="', linkUrl, '"  target="_blank">'
                , '    <div class="image">'
                , '      <div class="price average-color"  ><span>权值:', weighting, '</span></div><img src="', imgUrl, '" alt=""></div>'
                , '<header class="average-color" >' 
                , '<h2 class="animate move_from_top_short idle"  ><span>', address, '</span></h2></header>'
                , '</a>'
                , '</div>'
                , '<div class="right">'
                , '  <article class="animate move_from_top_short idle" >' 
                , '  <p>', popupContent, '</p>'
                , '</article>'
                , '<article class="animate move_from_top_short idle" >' 
                , '              <dl><dt>坐&nbsp;标：</dt><dd style="text-align:left">', feature.geometry.coordinates[0].toFixed(6), ',', feature.geometry.coordinates[1].toFixed(6), '</dd>'
                
                , '    </dl>'
                , ' </article>'
                , '</div><div class="clearfix"></div>'
                , '</div>'].join('');


            this.infoWindow = new AMap.InfoWindow({
                content: info  //使用默认信息窗体框样式，显示信息内容
            });
            this.infoWindow.open(this.mapObj, feature.geometry.coordinates);
        },
        //向地图上添加标注
        _addMarkers: function (features, markerType) {
            var $self = this;
            var bounds = $self.mapObj.getBounds();

            features.forEach(function (el) {
                var feature = el;
                var marker;
                //var lng = feature.geometry.coordinates[0];
                //var lat = feature.geometry.coordinates[1];

                if (markerType == $self.markerType.small) {
                    marker = new AMap.Marker({
                        icon: $self.options.minMarkerImage,
                        position: feature.geometry.coordinates,
                        zIndex: 1,
                        extData: { type: markerType, feature: feature }//业务数据
                    });
                } else {
                    var _zIndex = 2;
                    if (feature.properties.cluster) {
                        if (feature.properties.wPoint.momentType == $self.momentsType.store) {
                            _zIndex = 99;
                        }
                    } else {
                        if (feature.properties.momentType == $self.momentsType.store) {
                            _zIndex = 99;
                        }
                    }
                    marker = new AMap.Marker({
                        //icon: 'images/marker-icon2.png',
                        position: feature.geometry.coordinates,
                        //animation: 'AMAP_ANIMATION_DROP',
                        offset: new AMap.Pixel(-17, -42), //相对于基点的偏移位置  
                        zIndex: _zIndex,
                        extData: { type: markerType, feature: feature }//业务数据
                    });
                    //点标注label
                    var labeltext = '';
                    //点标记显示内容，可以是HTML要素字符串或者HTML DOM对象
                    var content = '';
					var imgUrl = 'images/8.jpg';
                    if (feature.properties.cluster) {
                        content = '<div class="marker-route marker-marker-bus-from animated fadeIn">'
                            + (feature.properties.wPoint.momentType == $self.momentsType.store ? '<img class="store-welcome" src="./images/ic_welcome.png">' : '')
                            + "<img style=\"border-radius: 2px;width:32px;height:32px;margin-top:15px;margin-left:3px\" src=\"" + imgUrl + " \"/> "
                            + '</div>';
                        labeltext = feature.properties.wPoint.commentCount > 99 ? '99+' : feature.properties.wPoint.commentCount;//feature.properties.pointId;
                    } else {
                        content = '<div class="marker-route marker-marker-bus-from">'
                            + (feature.properties.momentType == $self.momentsType.store ? '<img class="store-welcome" src="./images/ic_welcome.png">' : '')
                            + "<img style=\"border-radius: 2px;width:32px;height:32px;margin-top:15px;margin-left:3px\" src=\" " +imgUrl + " \"/> "
                            + '</div>';
                        labeltext = feature.properties.commentCount > 99 ? '99+' : feature.properties.commentCount;//feature.properties.pointId;
                    }
                    //自定义点标记覆盖物内容
                    marker.setContent(content);
                    // 设置label标签
                    // marker.setLabel({//label默认蓝框白底左上角显示，样式className为：amap-marker-label
                    //     offset: new AMap.Pixel(28, 0),//修改label相对于maker的位置
                    //     content: labeltext
                    // });  
                    marker.on('click', function (e) {
                        $self._openWindowInfo(e.target.getExtData().feature);
                        // mapObj.setCenter(feature.geometry.coordinates);
                    });
                }
                //将点标注存储起来，方便管理地图上的标注
                $self.markersInMap.push({
                    position: marker.getPosition(),
                    extData: marker.getExtData(),
                    marker: marker
                });
                //将点标注加到地图上
                marker.setMap($self.mapObj);

            });
        },
        _initWorker: function (workerjs) {
            var $self = this;
            var log = $self.options.log;

            $self.worker = new Worker(workerjs);
            //接收worker传过来的数据函数
            $self.worker.onmessage = function (e) {
                //1表示聚合运算后返回   2表示查找抽稀点返回
                if (e.data.actionType == $self.messageActionType.saved) {
                    $self.ready = true;
                    //如果是第一次加载 则更新数据
                    if ($self.firstLoad) {
                        $self.firstLoad = false;
                        $self._updateMap();

                        if (log) console.log('第一次POI数据加载后，更新地图点标注');
                    }
                } else {
                    var lowLevel = e.data.lowLevel;
                    var currentLevel = e.data.currentLevel;
                    //如果是缩小操作  直接删除所有点
                    if ($self.lastMapAction == $self.mapActionType.zoomOut) {
                        $self.mapObj.clearMap();
                        $self.markersInMap = [];

                        //添加小点
                        $self._addMarkers(lowLevel, $self.markerType.small);
                        //添加大点
                        $self._addMarkers(currentLevel, $self.markerType.big);
                        return false;
                    }


                    if (log) console.log('更新地图点标注');
                    //移除不在视图内的点
                    var bounds = $self.mapObj.getBounds();
                    var filtercurrentLevel = [];
                    var filterlowLevel = [];

                    var bigMarkerHash = {};
                    var smallMarkerHash = {};

                    var tmpmarkersInMap = [];

                    $self.markersInMap.forEach(function (el) {
                        if (!bounds.contains(el.position)) {
                            $self.mapObj.remove(el.marker);
                        }
                        else {
                            tmpmarkersInMap.push(el);
                        }
                    });
                    $self.markersInMap = tmpmarkersInMap;
                    //添加小点
                    $self._addMarkers(lowLevel, $self.markerType.small);
                    //添加大点
                    $self._addMarkers(currentLevel, $self.markerType.big);
                }
            };
        }
    }


    //格子管理器
    function TileGrid(radius) {
        this.MAX_LNG = 180.0  //最大经度
        this.MIN_LNG = -180.0 //最小经度
        this.MAX_LAT = 90.0   //最大纬度
        this.MIN_LAT = -90.0  //最小纬度

        this.COORDINATE_DIGITI = 6 //坐标 精确到小数点位数

        this.TOTAL_LNG = 360.0    //地球所有经度
        this.TOTAL_LAT = 180.0    //地球所有纬度
        this.SPACE = radius || 2.0 //格子最小刻度   0.000320
    }

    TileGrid.prototype = {
        //获取某个坐标属于某个格子    边界  -180，90  ~   180，-90
        getGridByPoint: function (lng, lat, zoom) {

            var tmpSpaceAndLevel = this.getSpaceAndLevel(zoom);
            var tmpSpace = tmpSpaceAndLevel.space;
            var tmpLevel = tmpSpaceAndLevel.level;

            //横向格子编号
            var lngNo = Math.floor((this.MAX_LNG + lng) / tmpSpace);
            //横向格子 左上角经度    西北
            var lngT = (lngNo * tmpSpace) - this.MAX_LNG; //((经度格子号*当前等级格子刻度)-最大经度)
            var lngT2 = ((lngNo + 1) * tmpSpace) - this.MAX_LNG; // ((经度格子号*当前等级格子刻度)-最大经度)

            //纵向格子编号    东南
            var latNo = Math.floor((this.MAX_LAT - lat) / tmpSpace); //向下取整( (最大经度+当前经度坐标)/当前等级的 格子刻度)
            //纵向格子 左上角经度
            var latT = this.MAX_LAT - (latNo * tmpSpace);// (最大纬度-(纬度格子号*当前等级格子刻度))
            var latT2 = this.MAX_LAT - ((latNo + 1) * tmpSpace);// (最大纬度-(纬度格子号*当前等级格子刻度))

            return {
                lngNo: lngNo,   //格子经度编号
                latNo: latNo,//格子纬度编号
                lng: lngT,//格子左上角经度
                lat: latT,//格子左上角纬度
                lng2: lngT2,//格子右下角经度
                lat2: latT2,//格子右下角纬度
                level: tmpLevel,//格子层级
                gridNo: tmpLevel + '_' + lngNo + '_' + latNo//格子编号
            }
        },
        /**
         * 根据缩放比例获得相应的 格子刻度和编号层级
         */
        getSpaceAndLevel: function (zoom) {
            var tmpSpace = this.SPACE;
            var tmpLevel = 0;
            if (zoom < 5 && zoom >= 0) {
                tmpSpace = Math.pow(this.SPACE, 6);//64;
                tmpLevel = 0;
            } else if (zoom < 8 && zoom >= 5) {
                tmpSpace = Math.pow(this.SPACE, 4);//16;
                tmpLevel = 5;
            } else if (zoom < 12 && zoom >= 8) {
                tmpSpace = Math.pow(this.SPACE, 3);//8;
                tmpLevel = 8;
            } else if (zoom < 15 && zoom >= 12) {
                tmpSpace = Math.pow(this.SPACE, 2);//4;
                tmpLevel = 12;
            } else {//>=15
                tmpSpace = Math.pow(this.SPACE, 1);//2
                tmpLevel = 15;
            }
            return { 'space': tmpSpace, 'level': tmpLevel };
        },
        //根据格子编号 获取 格子 坐标
        getGridCoordinate: function (lngNo, latNo, zoom) {

            var tmpSpaceAndLevel = this.getSpaceAndLevel(zoom);
            var tmpSpace = tmpSpaceAndLevel.space;
            //var tmpLevel = tmpSpaceAndLevel.level;

            var lng = lngNo * tmpSpace - this.MAX_LNG;
            var lat = this.MAX_LAT - latNo * tmpSpace;

            return [lng, lat];
        },
        getGridByBounds: function (lng1, lat1, lng2, lat2, zoom) {

            var tmpSpaceAndLevel = this.getSpaceAndLevel(zoom);
            //var tmpSpace = tmpSpaceAndLevel.space;
            var tmpLevel = tmpSpaceAndLevel.level;


            //左上角格子
            var left_top_grid = this.getGridByPoint(lng1, lat1, zoom);
            //右下角格子
            var right_bottom_grid = this.getGridByPoint(lng2, lat2, zoom);

            //console.log(left_top_grid);
            //console.log(right_bottom_grid);

            //横向格子数
            var lngGridNum = Math.abs(right_bottom_grid.lngNo - left_top_grid.lngNo) + 1;

            //纵向格子数
            var latGridNum = Math.abs(left_top_grid.latNo - right_bottom_grid.latNo) + 1;

            var grids = [];

            for (var i = 0; i < lngGridNum; i++) {
                for (var j = 0; j < latGridNum; j++) {
                    var lngNoTmp = left_top_grid.lngNo + i;
                    var latNoTmp = left_top_grid.latNo + j;

                    var gridCoord = this.getGridCoordinate(lngNoTmp, latNoTmp, zoom);
                    var gridCoord2 = this.getGridCoordinate(lngNoTmp + 1, latNoTmp + 1, zoom);

                    var grid = {
                        lngNo: lngNoTmp,
                        latNo: latNoTmp,
                        lng: gridCoord[0],
                        lat: gridCoord[1],
                        lng2: gridCoord2[0],
                        lat2: gridCoord2[1],
                        level: tmpLevel,
                        gridNo: tmpLevel + '_' + lngNoTmp + '_' + latNoTmp
                    };
                    grids.push(grid);
                }
            }
            return grids;
        }
    }


    function extend(dest, src) {
        for (var id in src) dest[id] = src[id];
        return dest;
    }

    function mapApp(options) {
        return new MapApp(options);
    }
    window.mapApp = mapApp;

} (document, async)); 