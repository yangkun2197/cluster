/**
 * 地图后台服务处理
 * 
 */
(function () {
    'use strict';
    importScripts('rbush.js');
    importScripts('cluster.js');

    var log = false;
    //声明聚类处理类   
    var index;

    //与主线程通讯的消息类型
    var messageActionType = {
        saved: 1,//表示聚合运算后（即数据存储到R树后）返回
        searched: 2//表示查找R树后返回
    };
    //点标注类型 
    var markerType = {
        big: 1,
        small: 2
    };

    //获取主线程传来的消息  进行处理
    self.onmessage = function (e) {
        if (e.data) {
            //1标示聚合运算   2标示查找抽稀点
            if (e.data.actionType == messageActionType.saved) {
                var loadTrees = e.data.loadTrees;
                //console.log(loadTrees);
                var cityCode = e.data.cityCode;
                if (loadTrees) {
                    loadTrees = gisDataUnique(loadTrees);
                    //loadTrees = quickSort(loadTrees); 
                    //loadTrees.sort(function (a, b) { return a.weighting > b.weighting ? 1 : -1 }); 
                    if (loadTrees.length > 0) {
                        if (index) {
                            index.load(loadTrees, cityCode);
                        } else {
                            var opt = {
                                log: log,
                                radius: IsPC() ? 120 : 100,
                                extent: 256,
                                minZoom: 1,
                                maxZoom: 17
                            };
                            index = new MyCluster(opt).load(loadTrees, cityCode);
                        }
                        //告诉主线程 已经准备好数据了
                        postMessage({
                            actionType: messageActionType.saved,
                            ready: true
                        });
                    }
                }
            } else {
                var data = e.data;
                var cityCodes = e.data.cityCodes;
                //index.append([],cityCodes[0]); 
                //存放 当前级别的点
                var currentLevel = null;
                //存放 下一级别的点
                var lowLevel = null;
                currentLevel = index.getClusters(data.bbox, data.zoom, cityCodes);
                var lowLevelZoom = data.zoom + 1;
                lowLevel = index.getClusters(data.bbox, lowLevelZoom, cityCodes);
                if (currentLevel.length > 0) {
                    handleData(data, cityCodes, currentLevel, lowLevel);
                } else {
                    //如果第一次没有请求到数据，等1.5秒后再查询一次
                    setTimeout(function () {
                        currentLevel = index.getClusters(data.bbox, data.zoom, cityCodes);
                        lowLevelZoom = data.zoom + 1;
                        lowLevel = index.getClusters(data.bbox, lowLevelZoom, cityCodes);
                        handleData(data, cityCodes, currentLevel, lowLevel); 
                    }, 1500);
                }
            }
        }
    };
/**
 * 处理查询出来的数据  并传递给主线程
 * 
 * @param {any} data
 * @param {any} cityCodes
 * @param {any} currentLevel
 * @param {any} lowLevel
 */
    function handleData(data, cityCodes, currentLevel, lowLevel) { 
        var tmplowLevel = [];
        var now = Date.now();
        //将下一级别的点过滤掉，过滤规则：只要是上一级存在该点，就过滤掉
        var currentLevelHash = {};
        currentLevel.forEach(function (p) {
            var key = typeof (p.properties.pointId) + p.properties.pointId;
            currentLevelHash[key] = 1;
        });

        lowLevel.forEach(function (p) {
            var key = typeof (p.properties.pointId) + p.properties.pointId;
            if (currentLevelHash[key] != 1) {
                tmplowLevel.push(p);
            }
        });
        lowLevel = tmplowLevel;

        if (log) console.log('--和地图上的点过滤前，currentLevel');
        if (log) console.log(JSON.stringify(currentLevel.map(function (p) {
            return p.properties.pointId;
        })));
        if (log) console.log('--和地图上的点过滤前，lowLevel');
        if (log) console.log(JSON.stringify(lowLevel.map(function (p) {
            return p.properties.pointId;
        })));


        //过滤掉地图上已经有的点
        if (data.markerInMap && data.markerInMap.length > 0) {

            var markerInMap = data.markerInMap;

            var filtercurrentLevel = [];
            var filterlowLevel = [];

            var bigMarkerHash = {};
            var smallMarkerHash = {};

            markerInMap.forEach(function (el) {
                var key = typeof (el.extData.feature.properties.pointId) + el.extData.feature.properties.pointId;
                if (el.extData.type == markerType.big) {//markerType.big  大点
                    bigMarkerHash[key] = 1;
                }
                if (el.extData.type == markerType.small) {//markerType.small   小点

                    smallMarkerHash[key] = 1;
                }
            });
            if (log) console.log('--和地图上已存在的大点，');
            if (log) console.log(JSON.stringify(bigMarkerHash));
            if (log) console.log('--和地图上已存在的小点，');
            if (log) console.log(JSON.stringify(smallMarkerHash));

            //如果地图上已经存在该点，就过滤掉
            currentLevel.forEach(function (p) {
                var key = typeof (p.properties.pointId) + p.properties.pointId;
                if (bigMarkerHash[key] != 1) {
                    filtercurrentLevel.push(p);
                }
            });
            lowLevel.forEach(function (p) {
                var key = typeof (p.properties.pointId) + p.properties.pointId;
                if (smallMarkerHash[key] != 1) {
                    filterlowLevel.push(p);
                }
            });
            currentLevel = filtercurrentLevel;
            lowLevel = filterlowLevel;
        }
        if (log) console.log('--和地图上的点过滤后，currentLevel');
        if (log) console.log(JSON.stringify(currentLevel.map(function (p) {
            return p.properties.pointId;
        })));
        if (log) console.log('--和地图上的点过滤后，lowLevel');
        if (log) console.log(JSON.stringify(lowLevel.map(function (p) {
            return p.properties.pointId;
        })));

        if (data.zoom >= 18) {
            currentLevel.reverse();
        }

        //发送给主线程 聚合好的数据
        postMessage({
            actionType: messageActionType.searched,
            currentLevel: currentLevel,
            lowLevel: lowLevel
        });
    }


    //空间数据 数组去重     根据业务数据dataId来去重
    function gisDataUnique(arr) {
        var ret = [];
        var hash = {};
        for (var i = 0; i < arr.length; i++) {
            var item = arr[i];
            var key = typeof (item.properties.dataId) + item.properties.dataId;

            if (hash[key] !== 1) {
                ret.push(item);
                hash[key] = 1;
            }
        }
        return ret;
    }

    //快速排序  按照权重 倒序
    function quickSort(arr) {
        if (arr.length <= 1) { return arr; }
        var pivotIndex = Math.floor(arr.length / 2);
        var pivot = arr.splice(pivotIndex, 1)[0];
        var left = [];
        var right = [];
        for (var i = 0; i < arr.length; i++) {
            if (arr[i].weighting < pivot.weighting) {
                left.push(arr[i]);
            } else {
                right.push(arr[i]);
            }
        }
        return quickSort(left).concat([pivot], quickSort(right));
    };


    function IsPC() {
        var userAgentInfo = navigator.userAgent;
        var Agents = ["Android", "iPhone",
            "SymbianOS", "Windows Phone",
            "iPad", "iPod"];
        var flag = true;
        for (var v = 0; v < Agents.length; v++) {
            if (userAgentInfo.indexOf(Agents[v]) > 0) {
                flag = false;
                break;
            }
        }
        return flag;
    }

} ()); 