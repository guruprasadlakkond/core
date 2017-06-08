/*
 Copyright [2016] [Relevance Lab]

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

const logger = require('_pr/logger')(module);
var async = require('async');
var apiUtil = require('_pr/lib/utils/apiUtil.js');
var services = require('_pr/model/services/services.js');
var fileUpload = require('_pr/model/file-upload/file-upload');
var monitors = require('_pr/model/monitors/monitors');
var appConfig = require('_pr/config');
var fileIo = require('_pr/lib/utils/fileio');
var masterUtil = require('_pr/lib/utils/masterUtil.js');
var monitorsModel = require('_pr/model/monitors/monitors.js');
const ymlJs= require('yamljs');
var uuid = require('node-uuid');
var Cryptography = require('_pr/lib/utils/cryptography');
var resourceModel = require('_pr/model/resources/resources');
var commonService = require('_pr/services/commonService');

var serviceMapService = module.exports = {};

serviceMapService.getAllServicesByFilter = function getAllServicesByFilter(reqQueryObj,callback){
    var reqData = {};
    async.waterfall([
        function (next) {
            apiUtil.paginationRequest(reqQueryObj, 'services', next);
        },
        function(paginationReq,next){
            reqData = paginationReq;
            apiUtil.databaseUtil(paginationReq, next);
        },
        function (queryObj, next) {
            services.getLastVersionOfEachService(queryObj.queryObj,function(err,data){
                if(err){
                    next(err,null);
                }else if(data.length > 0){
                    services.getAllServicesByFilter(queryObj, function(err,filterData){
                        if(err){
                            next(err,null);
                        }else{
                            var response = {
                                docs:filterData,
                                total:data.length,
                                limit:queryObj.options.limit,
                                page:queryObj.options.page,
                                pages:Math.ceil(data.length / queryObj.options.limit)
                            };
                            next(null,response);
                        }
                    });
                }else{
                    var response = {
                        docs:data,
                        total:data.length,
                        limit:queryObj.options.limit,
                        page:queryObj.options.page,
                        pages:Math.ceil(data.length / queryObj.options.limit)
                    };
                    next(null,response);
                }
            })
        },
        function(services,next){
            changeServiceResponse(services,next);
        },
        function(serviceList,next){
            apiUtil.paginationResponse(serviceList, reqData, next);
        }
    ],function(err,results){
        if(err){
            logger.error(err);
            callback(err,null);
            return;
        }else{
            callback(null,results);
            return;
        }
    })

};
serviceMapService.deleteServiceById = function deleteServiceById(serviceId,callback){
    async.waterfall([
        function(next){
            services.getServiceById(serviceId,next);
        },
        function(servicesData,next){
            if(servicesData.length > 0){
                services.updateService({name:servicesData[0].name},{isDeleted:true},next);
            }else{
                var err =  new Error();
                err.code = 500;
                err.message = "No Service is available in DB against Id "+serviceId;
                next(err,null);
            }
        }
    ],function(err,results){
        if(err){
            callback(err,null);
            return;
        }else{
            callback(null,results);
            return;
        }
    })
}

serviceMapService.getAllServiceVersionByName = function getAllServiceVersionByName(serviceName,callback){
    async.waterfall([
        function(next){
            services.getServices({name:serviceName},next);
        }
    ],function(err,results){
        if(err){
            callback(err,null);
            return;
        }else{
            callback(null,results);
            return;
        }
    })
}

serviceMapService.createNewService = function createNewService(servicesObj,callback){
    if(servicesObj.ymlFileId && servicesObj.ymlFileId !== null) {
        services.createNew(servicesObj, function (err, servicesData) {
            if (err) {
                logger.error("services.createNew is Failed ==>", err);
                callback(err, null);
                return;
            } else {
                callback(null, servicesData);
                return;
            }
        });
    }else{
        services.getServices({name:servicesObj.name},function(err,data) {
            if (err) {
                logger.error("Error in getting Services against Service Name: ", servicesObj.name, err);
                return callback(err, null);
            } else if (data.length > 0) {
                return callback({code: 400, message: "Service Name is already associated with other Services.Please enter unique Service Name."}, null);
            } else {
                fileUpload.getReadStreamFileByFileId(servicesObj.fileId, function (err, fileDetail) {
                    if (err) {
                        logger.error("Error in reading YML File.");
                        callback(err, null);
                        return;
                    } else {
                        var fileName = uuid.v4() + '_' + fileDetail.fileName;
                        var desPath = appConfig.tempDir + fileName;
                        fileIo.writeFile(desPath, fileDetail.fileData, false, function (err) {
                            if (err) {
                                logger.error("Unable to write file");
                                callback(err, null);
                                return;
                            } else {
                                ymlJs.load(desPath, function (result) {
                                    if (result !== null) {
                                        servicesObj.identifiers = result;
                                        servicesObj.type = 'Service';
                                        servicesObj.ymlFileId = servicesObj.fileId;
                                        servicesObj.createdOn = new Date().getTime();
                                        getMasterDetails(servicesObj.masterDetails,function(err,result) {
                                            if (err) {
                                                logger.error("Unable to Master Details");
                                                callback(err, null);
                                                return;
                                            } else {
                                                monitorsModel.getById(servicesObj.monitorId, function (err, monitor) {
                                                    servicesObj.masterDetails = result;
                                                    servicesObj.masterDetails.monitor = monitor;
                                                    servicesObj.state = 'Initializing';
                                                    services.createNew(servicesObj, function (err, servicesData) {
                                                        if (err) {
                                                            logger.error("services.createNew is Failed ==>", err);
                                                            callback(err, null);
                                                            apiUtil.removeFile(desPath);
                                                            return;
                                                        } else {
                                                            callback(null, servicesData);
                                                            apiUtil.removeFile(desPath);
                                                            return;
                                                        }
                                                    });
                                                });
                                            }
                                        });
                                    } else {
                                        var err = new Error("There is no data present YML.")
                                        err.code = 403;
                                        callback(err, null);
                                        apiUtil.removeFile(desPath);
                                    }
                                })
                            }
                        });
                    }
                });
            }
        });
    }
}

serviceMapService.updateServiceById = function updateServiceById(serviceId,data,callback){
    async.waterfall([
        function(next){
            services.getServiceById(serviceId,next);
        },
        function(servicesData,next){
            if(servicesData.length > 0){
                services.updateServiceById(serviceId,data,next);
            }else{
                var err =  new Error();
                err.code = 500;
                err.message = "No Service is available in DB against serviceId "+serviceId;
                next(err,null);
            }
        }
    ],function(err,results){
        if(err){
            callback(err,null);
            return;
        }else{
            callback(null,results);
            return;
        }
    })
}

serviceMapService.getLastVersionOfEachService = function getLastVersionOfEachService(filterBy,callback){
    async.waterfall([
        function(next){
            services.getLastVersionOfEachService(filterBy,next);
        },
        function(servicesData,next){
            if(servicesData.length > 0){
                next(null,servicesData);
            }else{
                logger.debug("No Service is available in DB: ");
                next(null,servicesData);
            }
        }
    ],function(err,results){
        if(err){
            callback(err,null);
            return;
        }else{
            callback(null,results);
            return;
        }
    })
}

serviceMapService.updateService = function updateService(filterQuery,data,callback){
    async.waterfall([
        function(next){
            services.getServices(filterQuery,next);
        },
        function(servicesData,next){
            if(servicesData.length > 0){
                services.updateService(filterQuery,data,next);
            }else{
                var err =  new Error();
                err.code = 500;
                err.message = "No Service is available in DB against filterQuery "+filterQuery;
                next(err,null);
            }
        }
    ],function(err,results){
        if(err){
            callback(err,null);
            return;
        }else{
            callback(null,results);
            return;
        }
    })
}

serviceMapService.resourceAuthentication = function resourceAuthentication(serviceId,resourceId,credentials,callback){
    async.waterfall([
        function(next){
            services.getServiceById(serviceId,next);
        },
        function(servicesData,next){
            if(servicesData.length >0){
                resourceModel.getResourceById(resourceId,function(err,resourceDetail){
                    if(err){
                        var error =  new Error();
                        error.code = 500;
                        error.message = "Error in getting Resource Details By Id: "+resourceId +' : '+ err;
                        next(error,null);
                    }
                    if(resourceDetail !== null) {
                        next(null, {code: 202, message: "Authentication is in Progress"});
                        services.updateService({
                            name: servicesData[0].name,
                            'resources': {$elemMatch: {id: resourceId}}
                        }, {
                            'resources.$.authentication': 'authenticating'
                        }, function (err, result) {
                            if (err) {
                                logger.error("Error in updating Service State:", err);
                            }
                            resourceModel.updateResourceById(resourceId, {
                                'authentication': 'authenticating'
                            }, function (err, data) {
                                if (err) {
                                    logger.error("Error in updating Resource BootStrap State:", err);
                                }
                                var nodeDetail = {
                                    nodeIp: resourceDetail.resourceDetails.publicIp && resourceDetail.resourceDetails.publicIp !== null ? resourceDetail.resourceDetails.publicIp : resourceDetail.resourceDetails.privateIp,
                                    nodeOs: resourceDetail.resourceDetails.os
                                }
                                if (credentials.type && credentials.type === 'password') {
                                    commonService.checkNodeCredentials(credentials, nodeDetail, function (err, credentialFlag) {
                                        if (err || credentialFlag === false) {
                                            logger.error("Invalid Resource Credentials", err);
                                            services.updateService({
                                                name: servicesData[0].name,
                                                'resources': {$elemMatch: {id: resourceId}}
                                            }, {
                                                'resources.$.authentication': 'failed',
                                                state: serviceState
                                            }, function (err, result) {
                                                if (err) {
                                                    logger.error("Error in updating Service State:", err);
                                                }
                                            });
                                            resourceModel.updateResourceById(resourceId, {
                                                'authentication': 'failed',
                                            }, function (err, data) {
                                                if (err) {
                                                    logger.error("Error in updating BootStrap State:", err);
                                                }
                                            });
                                        } else {
                                            var serviceState = 'Initializing';
                                            if (servicesData[0].resources.length > 1) {
                                                servicesData[0].resources.forEach(function (instance) {
                                                    if (instance.id !== resourceId && instance.authentication === 'failed') {
                                                        serviceState = 'Authentication_Error';
                                                    }
                                                });
                                            }
                                            services.updateService({
                                                name: servicesData[0].name,
                                                'resources': {$elemMatch: {id: resourceId}}
                                            }, {
                                                'resources.$.bootStrapState': 'bootStrapping',
                                                'resources.$.authentication': 'success',
                                                state: serviceState
                                            }, function (err, result) {
                                                if (err) {
                                                    logger.error("Error in updating Service State:", err);
                                                }
                                                resourceModel.updateResourceById(resourceId, {
                                                    'authentication': 'success',
                                                    'resourceDetails.bootStrapState': 'bootStrapping'
                                                }, function (err, data) {
                                                    if (err) {
                                                        logger.error("Error in updating BootStrap State:", err);
                                                    }
                                                    commonService.bootstrapInstance(resourceDetail, credentials, servicesData[0], function (err, res) {
                                                        if (err) {
                                                            var error = new Error();
                                                            error.code = 500;
                                                            error.message = "Error in Bootstraping Resource : " + err;
                                                            next(error, null);
                                                        } else {
                                                            next(null, res);
                                                        }
                                                    });
                                                });
                                            });
                                        }
                                    })
                                } else if (credentials.type && credentials.type === 'pemFile') {
                                    commonService.checkNodeCredentials(nodeDetail, credentials, function (err, credentialFlag) {
                                        if (err || credentialFlag === false) {
                                            logger.error("Invalid Resource Credentials", err);
                                            services.updateService({
                                                name: servicesData[0].name,
                                                'resources': {$elemMatch: {id: resourceId}}
                                            }, {
                                                'resources.$.authentication': 'failed',
                                                state: serviceState
                                            }, function (err, result) {
                                                if (err) {
                                                    logger.error("Error in updating Service State:", err);
                                                }
                                            });
                                            resourceModel.updateResourceById(resourceId, {
                                                'authentication': 'failed',
                                            }, function (err, data) {
                                                if (err) {
                                                    logger.error("Error in updating BootStrap State:", err);
                                                }
                                            });
                                        } else {
                                            next(null, {message: "Authentication is Done for Resource"});
                                            var serviceState = 'Initializing';
                                            if (servicesData[0].resources.length > 1) {
                                                servicesData[0].resources.forEach(function (instance) {
                                                    if (instance.id !== resourceId && instance.authentication === 'failed') {
                                                        serviceState = 'Authentication_Error';
                                                    }
                                                });
                                            }
                                            services.updateService({
                                                'name': servicesData[0].name,
                                                'resources': {$elemMatch: {id: resourceId}}
                                            }, {
                                                'resources.$.bootStrapState': 'bootStrapping',
                                                'resources.$.authentication': 'success',
                                                'state': serviceState
                                            }, function (err, result) {
                                                if (err) {
                                                    logger.error("Error in updating Service State:", err);
                                                }
                                                resourceModel.updateResourceById(resourceId, {
                                                    'authentication': 'success',
                                                    'resourceDetails.bootStrapState': 'bootStrapping'
                                                }, function (err, data) {
                                                    if (err) {
                                                        logger.error("Error in updating BootStrap State:", err);
                                                    }
                                                    commonService.bootstrapInstance(resourceDetail, credentials, servicesData[0], function (err, res) {
                                                        if (err) {
                                                            logger.error(err);
                                                        }
                                                    });
                                                });
                                            });
                                        }
                                    });
                                } else {
                                    var error = new Error();
                                    error.code = 500;
                                    error.message = "Invalid Credential Type";
                                    next(error, null);
                                }
                            })
                        })
                    }else{
                        var err =  new Error();
                        err.code = 500;
                        err.message = "No Resource is available in DB against resourceId: "+resourceId;
                        next(err,null);
                    }
                })

            }else{
                var err =  new Error();
                err.code = 500;
                err.message = "No Service is available in DB against serviceId: "+serviceId;
                next(err,null);
            }
        }
    ],function(err,results){
        if(err){
            callback(err,null);
            return;
        }else{
            callback(null,results);
            return;
        }
    })
}

serviceMapService.getServices = function getServices(filterQuery,callback){
    async.waterfall([
        function(next){
            services.getServices(filterQuery,next);
        }
    ],function(err,results){
        if(err){
            callback(err,null);
            return;
        }else{
            callback(null,results);
            return;
        }
    })
}

serviceMapService.getServiceResources = function getServiceResources(serviceId,filterQuery,callback){
    async.waterfall([
        function(next){
            services.getServiceById(serviceId,next);
        },
        function(serviceList,next){
            var keyList = [];
            if(serviceList.length > 0 && serviceList[0].resources.length > 0){
                var resourceObj = {},filterResourceList = [];
                if(filterQuery.ami && filterQuery.ami !== null){
                    resourceObj['ami'] = filterQuery.ami;
                    keyList.push('ami');
                }
                if(filterQuery.ip && filterQuery.ip !== null){
                    resourceObj['ip'] = filterQuery.ip;
                    keyList.push('ip');
                }
                if(filterQuery.vpc && filterQuery.vpc !== null){
                    resourceObj['vpc'] = filterQuery.vpc;
                    keyList.push('vpc');
                }
                if(filterQuery.subnet && filterQuery.subnet !== null){
                    resourceObj['subnet'] = filterQuery.subnet;
                    keyList.push('subnet');
                }
                if(filterQuery.tags && filterQuery.tags !== null){
                    resourceObj['tags'] = filterQuery.tags;
                    keyList.push('tags');
                }
                if(filterQuery.keyPairName && filterQuery.keyPairName !== null){
                    resourceObj['keyPairName'] = filterQuery.keyPairName;
                    keyList.push('keyPairName');
                }
                if(filterQuery.group && filterQuery.group !== null){
                    resourceObj['group'] = filterQuery.group;
                    keyList.push('group');
                }
                if(filterQuery.roles && filterQuery.roles !== null){
                    resourceObj['roles'] = filterQuery.roles;
                    keyList.push('roles');
                }
                serviceList[0].resources.forEach(function(resource){
                    var filterObj = {};
                    Object.keys(resource).forEach(function(key){
                        if(keyList.indexOf(key) !== -1){
                            filterObj[key] = resource[key];
                        }
                    });
                    if(JSON.stringify(resourceObj) === JSON.stringify(filterObj)){
                        resourceObj['id'] = resource.id;
                        resourceObj['type'] =resource.type;
                        resourceObj['category'] =resource.category;
                        resourceObj['platformId']= resource.platformId;
                        resourceObj['name'] = resource.name;
                        resourceObj['state'] = resource.state;
                        filterResourceList.push(resourceObj);
                    }
                });
                next(null,filterResourceList);
            }else{
                next(null,serviceList[0].resources);
            }
        }
    ],function(err,results){
        if(err){
            callback(err,null);
            return;
        }else{
            callback(null,results);
            return;
        }
    })
}



serviceMapService.getServiceById = function getServiceById(serviceId,callback){
    async.waterfall([
        function(next){
            services.getServiceById(serviceId,next);
        },
        function(serviceList,next){
            changeServiceResponse(serviceList,next);
        }
    ],function(err,results){
        if(err){
            callback(err,null);
            return;
        }else{
            callback(null,results);
            return;
        }
    })
}

function changeServiceResponse(services,callback){
    var serviceList  = [],resultList =[];
    if(services.docs && services.docs.length > 0){
        serviceList = services.docs;
    }else{
        serviceList = services;
    }
    if(serviceList.length > 0){
        var count = 0;
        for(var  i = 0 ; i < serviceList.length; i++){
            (function(service){
                formattedServiceResponse(service,function(err,data){
                    if(err){
                        logger.error("Error in formatted Service Response:");
                    }
                    count++;
                    if(data !== null) {
                        resultList.push(data);
                    }
                    if(count === serviceList.length){
                        if(services.docs && services.docs.length > 0){
                            services.docs = resultList;
                        }else{
                            services = resultList;
                        }
                        return callback(null,services);
                    }
                })
            })(serviceList[i]);
        }
    }else{
        return callback(null,serviceList);
    }
}

function formattedServiceResponse(service,callback){
    var serviceObj = {
        id:service.id,
        name:service.name,
        type:service.type,
        desc:service.desc,
        state:service.state,
        createdOn:service.createdOn,
        updatedOn:service.updatedOn,
        version:service.version.toFixed(1)
    }
    getMasterDetails(service.masterDetails,function(err,data){
            if(err){
                return callback(err,null);
            }
            serviceObj.masterDetails = data;
            serviceObj.masterDetails.monitor = service.masterDetails.monitor;
            if(service.ymlFileId){
                fileUpload.getReadStreamFileByFileId(service.ymlFileId,function(err,file){
                    if (err) {
                        logger.error("Error in fetching YAML Documents for : " + service.name + " " + err);
                        return callback(err,null);
                    }else {
                        serviceObj.ymlFileName = file !== null ? file.fileName : file;
                        serviceObj.ymlFileData = file !== null ? file.fileData : file;
                        return callback(null, serviceObj);
                    }
                });
            }else{
                return callback(null, serviceObj);
            }
    });
}

function getMasterDetails(masterDetail,callback){
    var settingDetail = {};
    masterUtil.getOrgByRowId(masterDetail.orgId,function(err,orgs) {
        if (err) {
            logger.error("Error in fetching Org Details for : " + masterDetail.orgId + " " + err);
            return callback(err, null);
        }
        settingDetail.orgId = masterDetail.orgId;
        settingDetail.orgName = orgs.length > 0 ? orgs[0].orgname : null;
        masterUtil.getBusinessGroupName(masterDetail.bgId, function (err, businessGroupName) {
            if (err) {
                logger.error("Error in fetching Bg Name for : " + masterDetail.bgId + " " + err);
                return callback(err, null);
            }
            settingDetail.bgId = masterDetail.bgId;
            settingDetail.bgName = businessGroupName;
            masterUtil.getProjectName(masterDetail.projectId, function (err, projectName) {
                if (err) {
                    logger.error("Error in fetching Project Name for : " + masterDetail.projectId + " " + err);
                    return callback(err, null);
                }
                settingDetail.projectId = masterDetail.projectId;
                settingDetail.projectName = projectName;
                masterUtil.getEnvironmentName(masterDetail.envId, function (err, envName) {
                    if (err) {
                        logger.error("Error in fetching Env Name for : " + masterDetail.envId + " " + err);
                        return callback(err, null);
                    }
                    settingDetail.envId = masterDetail.envId;
                    settingDetail.envName = envName;
                    masterUtil.getChefDetailsById(masterDetail.configId, function (err, chefDetails) {
                        if (err) {
                            logger.error("Error in fetching Org Details for : " + masterDetail.configId + " " + err);
                            return callback(err, null);
                        }
                        settingDetail.configId = masterDetail.configId;
                        settingDetail.configName = chefDetails !== null ? chefDetails[0].configname : null;
                        callback(null,settingDetail);
                    });
                });
            });
        });
    });
}

