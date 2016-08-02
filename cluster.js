//'use strict'; 
/**
 * 空间数据 聚类处理   基于多个R树  R树按照城市区域划分
 */
function mycluster(options) {
    return new MyCluster(options);
}

function MyCluster(options) {
    this.options = extend(Object.create(this.options), options);
    this._initTrees();
}

function formatCityCode(cityCode) {
    return '' + cityCode;//cityCode
}

MyCluster.prototype = {
    options: {
        minZoom: 0,   //  簇生成起始等级 
        maxZoom: 16,  //  簇生成结束等级
        radius: 49,   //     簇像素半径
        extent: 512,  //      瓦片像素半径
        nodeSize: 16, //    R-tree 叶子节点大小，对性能有影响的,
        log: false    //   
    },
    //追加点数据     适合于  知道每次追加的数据一定不会重复 这种情况的追加
    append: function (points, cityCode) {
        //todo
    },
    //追加点数据 重新生成树方式   适合于不知道每次追加的数据会不会重复  这种情况的追加
    appendByReload: function (points, cityCode) {
        if (points.length > 0) {
            var cityCode = formatCityCode(cityCode);
            //如果不存在此树，则直接生成
            if (!this.trees[cityCode]) {
                this.load(points, cityCode);
            } else {
                //查询找最小等级 的矩形边界
                var bbox = this.trees[cityCode][this.options.maxZoom].toJSON().bbox;
                //定义最大等级
                var zoom = Math.max(this.options.minZoom, Math.min(30, this.options.maxZoom + 1));
                //找到树中所有数据
                var oldClusters = this.trees[cityCode][zoom].search(bbox);
                // 为每个点生成一个簇对象
                var newClusters = points.map(createPointCluster);
                //合并 2个簇集合
                var clusters = oldClusters.concat(clusters);
                //过滤掉相同的簇
                clusters = clustersUnique(clusters);

                //生成R树 
                if (log) console.timeEnd(timerId);
                // 先处理最大缩放比例的点簇，以后的点簇都基于上一级的簇来计算
                // 按照缩放比例从最大到最小进行簇计算
                for (var z = this.options.maxZoom; z >= this.options.minZoom; z--) {
                    var now = +Date.now();
                    this.trees[cityCode][z + 1].load(clusters); //  将每一级的点 插入 R树索引    每一级都输入
                    clusters = this._cluster(clusters, z, cityCode); //  基于上一级的簇 创建一组新的簇

                    if (log) console.log('z%d: %d clusters in %dms', z, clusters.length, +Date.now() - now);
                }
                //   加载最小级簇
                this.trees[cityCode][this.options.minZoom].load(clusters);

                if (log) console.log('完成' + cityCode + '的数据增加到R树 ：共' + points.length + '个点');

                if (log) console.timeEnd('total time');
            }
        }
        return this;
    },

    //加载点数据 
    load: function (points, cityCode) {
        var cityCode = formatCityCode(cityCode);
        var log = this.options.log;

        if (log) console.time('total time');

        var timerId = 'prepare ' + points.length + ' points';
        if (log) console.time(timerId);
        //console.log(this.trees);
        if (!this.trees[cityCode]) {
            //建立每个缩放级别的R树索引
            this.trees[cityCode] = [];
            for (var z = 0; z <= this.options.maxZoom + 1; z++) {
                this.trees[cityCode][z] = rbush(this.options.nodeSize);
                this.trees[cityCode][z].toBBox = toBBox;
                this.trees[cityCode][z].compareMinX = compareMinX;
                this.trees[cityCode][z].compareMinY = compareMinY;
            }
        }
        // 为每个点生成一个簇对象
        var clusters = points.map(createPointCluster);
        if (log) console.timeEnd(timerId);

        // 先处理最大缩放比例的点簇，以后的点簇都基于上一级的簇来计算
        // 按照缩放比例从最大到最小进行簇计算
        for (var z = this.options.maxZoom; z >= this.options.minZoom; z--) {
            var now = +Date.now();

            this.trees[cityCode][z + 1].load(clusters); //  将每一级的点 插入 R树索引    每一级都输入
            clusters = this._cluster(clusters, z, cityCode); //  基于上一级的簇 创建一组新的簇

            if (log) console.log('z%d: %d clusters in %dms', z, clusters.length, +Date.now() - now);
        }
        //   加载最小级簇
        this.trees[cityCode][this.options.minZoom].load(clusters);

        if (log) console.log('完成' + cityCode + '的数据增加到R树 ：共' + points.length + '个点');
        if (log) console.timeEnd('total time');

        //console.log(this.trees[cityCode][this.options.minZoom].toJSON());
        //console.log(this.trees[cityCode][this.options.maxZoom].toJSON());

        return this;
    },

    //根据当前地图容器尺寸和缩放比例以及城市  获取簇
    getClusters: function (bbox, zoom, cityCodes) {
        var log = this.options.log;

        var projBBox = [lngX(bbox[0]), latY(bbox[3]), lngX(bbox[2]), latY(bbox[1])];
        var z = Math.max(this.options.minZoom, Math.min(zoom, this.options.maxZoom + 1));

        //console.log('查询' + cityCodes + ' 缩放' + zoom + '的聚类:........');
        var now = +Date.now();
        //var tree = this.trees[formatCityCode(cityCodes[0])][z];
        //console.log(tree);
        var clusters = [];
        for (var i = 0; i < cityCodes.length; i++) {
            if (this.trees[formatCityCode(cityCodes[i])]) {
                var cluster = this.trees[formatCityCode(cityCodes[i])][z].search(projBBox);
                clusters = clusters.concat(cluster);
            }
        }
        if (log) console.log('查询 clusters in %dms', +Date.now() - now);
        //console.log('查询' + cityCodes + ' 缩放' + zoom + '的聚类结果共:' + clusters.length + '条');

        return clusters.map(getClusterJSON);
    },
    //获取瓦片内的点，暂时没用          此方法未实现
    getTile: function (z, x, y, cityCode) {
        var z2 = Math.pow(2, z);
        var extent = this.options.extent;
        var p = this.options.radius / extent;
        var clusters = this.trees[cityCode][z].search([
            (x - p) / z2,
            (y - p) / z2,
            (x + 1 + p) / z2,
            (y + 1 + p) / z2
        ]);
        if (!clusters.length) return null;
        var tile = {
            features: []
        };
        for (var i = 0; i < clusters.length; i++) {
            var c = clusters[i];
            var feature = {
                type: 1,
                geometry: [[
                    Math.round(extent * (c.wx * z2 - x)),
                    Math.round(extent * (c.wy * z2 - y))
                ]],
                tags: c.point ? c.point.properties : getClusterProperties(c)
            };
            tile.features.push(feature);
        }
        return tile;
    },

    _initTrees: function () {
        this.trees = {};
        //建立每个缩放级别的R树索引
        // for (var z = 0; z <= this.options.maxZoom + 1; z++) {
        //     this.trees[z] = rbush(this.options.nodeSize);
        //     this.trees[z].toBBox = toBBox;
        //     this.trees[z].compareMinX = compareMinX;
        //     this.trees[z].compareMinY = compareMinY;
        // }
        // console.log( this.trees[1]);
    },

    _cluster: function (points, zoom, cityCode) {
        var clusters = [];
        var r = this.options.radius / (this.options.extent * Math.pow(2, zoom));        //簇地理半径  =  簇像素半径/(瓦片像素半径*2的zoom次方)
        var bbox = [0, 0, 0, 0];

        //  循环每一点
        for (var i = 0; i < points.length; i++) {
            var p = points[i];
            //如果已经访问了这个缩放级别的点，跳过它
            if (p.zoom <= zoom) continue;
            p.zoom = zoom;

            //构造一个BBOX（ 包围盒）  用来搜索附近的所有点       
            bbox[0] = p.wx - r;
            bbox[1] = p.wy - r;
            bbox[2] = p.wx + r;
            bbox[3] = p.wy + r;

            //搜索盒子附近的所有点（点 都从 计算好的上一级中查询出来）
            var bboxNeighbors = this.trees[cityCode][zoom + 1].search(bbox);

            //是否发现邻居
            var foundNeighbors = false;
            //簇包含的点个数
            var numPoints = p.numPoints;
            var wx = p.wx * numPoints;
            var wy = p.wy * numPoints;

            //存储邻居
            //var linjus = [];
            //存储最近邻居        作为簇中心点使用，以后会将权值最高的点作为簇中心
            var nearestPoint = null;

            nearestPoint = { 'p': p, 'dsq': 0 };//当基于距离计算的时候 把这个屏蔽掉

            for (var j = 0; j < bboxNeighbors.length; j++) {
                var b = bboxNeighbors[j];
                //过滤掉太远或已处理的邻居
                var dsq = distSq(p, b);
                if (zoom < b.zoom && dsq <= r * r) {
                    foundNeighbors = true;
                    b.zoom = zoom; //保存缩放（所以它不会被处理两次）
                    wx += b.wx * b.numPoints; //计算加权中心的累积坐标
                    wy += b.wy * b.numPoints;
                    numPoints += b.numPoints;

                    //存储最近邻居 的点，每次循环都比较下
                    // if (nearestPoint == null) {
                    //     nearestPoint = { 'p': b, 'dsq': dsq };
                    // }
                    // else {
                    //     if (dsq < nearestPoint.dsq) {
                    //         nearestPoint = { 'p': b, 'dsq': dsq };
                    //     } 
                    // }

                    //存储权值最大的点 
                    if (b.weighting > nearestPoint.p.weighting) {
                        nearestPoint = { 'p': b, 'dsq': dsq };
                    }

                }
            }

            //如果没有邻居，添加一个单一的点作为簇
            if (!foundNeighbors) {
                clusters.push(p);
                continue;
            }

            //与邻居形成一个簇
            var cluster = createCluster(p.x, p.y);
            cluster.numPoints = numPoints;

            //保存加权簇中心坐标  先注释掉 用下面的
            // cluster.wx = wx / numPoints;
            //cluster.wy = wy / numPoints;

            //将距离簇中心最近的点的坐标  作为簇的坐标，以后会将权值最高的点作为簇中心          linjus[Math.floor(Math.random()*linjus.length)];  
            var tmpPoint = nearestPoint.p;
            //console.log(tmpPoint);
            //return;
            cluster.wx = tmpPoint.wx;
            cluster.wy = tmpPoint.wy;

            if (tmpPoint.point == null) {
                if (tmpPoint.wPoint == null) {
                    cluster.wPoint = {
                        pointId: null,
                        name: null,
                        pic: null,
                        commentCount: 0,
                        userId: null,
                        weighting: 0,//权重
                        popupContent: null,
                        dataId: null,
                        address: null,
                        momentType: null,
                        nickName: null
                    };
                } else {
                    cluster.wPoint = tmpPoint.wPoint;
                }
            } else {
                cluster.wPoint = {};

                for (var p in tmpPoint.point.properties) {
                    var name = p;//属性名称 
                    var value = tmpPoint.point.properties[name];//属性对应的值 
                    cluster.wPoint[name] = value;
                }
            }
            clusters.push(cluster);
        }
        return clusters;
    }
};

/**
 * 将点坐标 转化为  盒子
 */
function toBBox(p) {
    return [p.x, p.y, p.x, p.y];
}
/**
 * 获取最小的经度值
 */
function compareMinX(a, b) {
    return a.x - b.x;
}
/**
 * 获取最小纬度值
 */
function compareMinY(a, b) {
    return a.y - b.y;
}

/**
 * 创建簇
 */
function createCluster(x, y) {
    return {
        x: x, // 簇中心
        y: y,
        wx: x, // 加权簇中心
        wy: y,
        zoom: Infinity, //记录该簇 做最后一次聚合处理的缩放等级，用来优化计算 ， Infinity 属性用于存放表示正无穷大的数值
        point: null,
        numPoints: 1,
        //wPoint:null   //簇中心坐标 基于的点    暂时不用
    };
}
/**
 * 创建点簇
 */
function createPointCluster(p) {
    //获取坐标
    var coords = p.geometry.coordinates;
    //创建点簇  
    var cluster = createCluster(lngX(coords[0]), latY(coords[1]));
    cluster.point = p;
    return cluster;
}

/**
 * 获取簇的JSON串
 */
function getClusterJSON(cluster) {
    //如果是点，则直接返回点的JSON，反之返回 簇的JSON
    return cluster.point ? cluster.point : {
        type: 'Feature',
        properties: getClusterProperties(cluster),
        geometry: {
            type: 'Point',
            coordinates: [xLng(cluster.wx), yLat(cluster.wy)]
        }
    };
}

/**
 * 构建 簇特性
 */
function getClusterProperties(cluster) {
    //簇内包含点数
    var count = cluster.numPoints;
    //处理数字显示
    var abbrev = count >= 10000 ? Math.round(count / 1000) + 'k' :
        count >= 1000 ? (Math.round(count / 100) / 10) + 'k' : count;
    //     return {
    //     cluster: true,
    //     pointId: cluster.pointId,   //簇中心点  基于的点ID
    //     // point:cluster.point,
    //     point_count: count,
    //     point_count_abbreviated: abbrev
    // };


    var propertie = {
        cluster: true,
        wPoint: cluster.wPoint,
        pointId: cluster.wPoint.pointId,   //簇中心点  基于的点ID
        // point:cluster.point,
        point_count: count,
        point_count_abbreviated: abbrev
    };

    // for (var p in cluster.wPoint) {
    //     var name = p;//属性名称 
    //     var value = cluster.wPoint[name];//属性对应的值 
    //     propertie[name] = value;
    // }



    return propertie;
}

// longitude/latitude to spherical mercator in [0..1] range     经度/纬度在球形墨卡托范围[ 0 。。1 ]。
//参考   https://github.com/istarkov/google-map-react/issues/62
//墨卡托坐标，主要用于程序的后台计算。直线距离嘛，加加减减几乎计算方便
//关于坐标系  参见  https://segmentfault.com/a/1190000000498434
function lngX(lng) {
    return lng / 360 + 0.5;
}
function latY(lat) {
    var sin = Math.sin(lat * Math.PI / 180),
        y = (0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI);
    return y < 0 ? 0 :
        y > 1 ? 1 : y;
}

// spherical mercator to longitude/latitude  获取 球形墨卡托投影经度 经度/纬度  
function xLng(x) {
    return (x - 0.5) * 360;
}
function yLat(y) {
    var y2 = (180 - y * 360) * Math.PI / 180;
    return 360 * Math.atan(Math.exp(y2)) / Math.PI - 90;
}

// 两点间的平方距离 即欧几里得距离
function distSq(a, b) {
    var dx = a.wx - b.wx;
    var dy = a.wy - b.wy;
    return dx * dx + dy * dy;
}

function extend(dest, src) {
    for (var id in src) dest[id] = src[id];
    return dest;
}


//簇 数组去重     根据业务数据PointId来去重
function clustersUnique(arr) {
    var ret = [];
    var hash = {};
    for (var i = 0; i < arr.length; i++) {
        var item = arr[i];
        var key = typeof (item.point.properties.pointId) + item.point.properties.pointId;
        //console.log(key);
        if (hash[key] !== 1) {
            ret.push(item);
            hash[key] = 1;
        }
    }
    return ret;
}
