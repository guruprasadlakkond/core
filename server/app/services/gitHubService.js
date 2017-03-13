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

var logger = require('_pr/logger')(module);
var gitHubModel = require('_pr/model/github/github.js');
var appConfig = require('_pr/config');
var Cryptography = require('_pr/lib/utils/cryptography');
var fileUpload = require('_pr/model/file-upload/file-upload');
var targz = require('targz');
var async = require('async');
var execCmd = require('exec');
var apiUtil = require('_pr/lib/utils/apiUtil.js');
var promisify = require("promisify-node");
var fse = promisify(require("fs-extra"));
var botsNewService = require("_pr/services/botsNewService.js");
var gitGubService = module.exports = {};

gitGubService.checkIfGitHubExists = function checkIfGitHubExists(gitHubId, callback) {
    gitHubModel.getById(gitHubId, function (err, gitHub) {
        if (err) {
            var err = new Error('Internal server error');
            err.status = 500;
            return callback(err);
        } else if (!gitHub) {
            var err = new Error('Git-Hub not found');
            err.status = 404;
            return callback(err);
        } else {
            return callback(null, gitHub);
            
        }
    });
};


gitGubService.createGitHub = function createGitHub(gitHubObj, callback) {
    if(gitHubObj.repositoryType === 'Private' && gitHubObj.authenticationType === 'userName'){
        var cryptoConfig = appConfig.cryptoSettings;
        var cryptography = new Cryptography(cryptoConfig.algorithm, cryptoConfig.password);
        gitHubObj.repositoryPassword =  cryptography.encryptText(gitHubObj.repositoryPassword, cryptoConfig.encryptionEncoding,
            cryptoConfig.decryptionEncoding);
    }
    gitHubModel.createNew(gitHubObj, function (err, gitHub) {
        if (err && err.name === 'ValidationError') {
            var err = new Error('Bad Request');
            err.status = 400;
            callback(err);
        } else if (err) {
            var err = new Error('Internal Server Error');
            err.status = 500;
            callback(err);
        } else {
            callback(null, gitHub);
        }
    });
};

gitGubService.updateGitHub = function updateGitHub(gitHubId, gitHubObj, callback) {
    if(gitHubObj.repositoryType === 'Private' && gitHubObj.authenticationType === 'userName'){
        var cryptoConfig = appConfig.cryptoSettings;
        var cryptography = new Cryptography(cryptoConfig.algorithm, cryptoConfig.password);
        gitHubObj.repositoryPassword =  cryptography.encryptText(gitHubObj.repositoryPassword, cryptoConfig.encryptionEncoding,
            cryptoConfig.decryptionEncoding);
    }
    gitHubModel.updateGitHub(gitHubId, gitHubObj, function (err, gitHub) {
        if (err && err.name === 'ValidationError') {
            var err = new Error('Bad Request');
            err.status = 400;
            callback(err);
        } else if (err) {
            var err = new Error('Internal Server Error');
            err.status = 500;
            callback(err);
        } else {
            callback(null, gitHub);
        }
    });
};

gitGubService.deleteGitHub = function deleteGitHub(gitHubId, callback) {
    gitHubModel.deleteGitHub(gitHubId, function (err, gitHub) {
        if (err) {
            var err = new Error('Internal server error');
            err.status = 500;
            return callback(err);
        } else {
            return callback(null, gitHub);
        }
    });
};

gitGubService.getGitHubSync = function getGitHubSync(gitHubId, callback) {
    gitHubModel.getGitHubById(gitHubId, function (err, gitHub) {
        if (err) {
            var err = new Error('Internal Server Error');
            err.status = 500;
            return callback(err);
        } else if (!gitHub) {
            var err = new Error('Git-Hub not found');
            err.status = 404;
            return callback(err);
        } else{
            formatGitHubResponse(gitHub,function(formattedGitHub){
                if(formattedGitHub.repositoryType === 'Private' && formattedGitHub.authenticationType === 'token') {
                    var cmd = 'curl -u '+formattedGitHub.repositoryUserName+':'+formattedGitHub.repositoryToken + ' -L https://api.github.com/repos/'+formattedGitHub.repositoryOwner+'/'+formattedGitHub.repositoryName+'/tarball/'+formattedGitHub.repositoryBranch + ' > '+formattedGitHub.repositoryName+'.tgz';
                    gitHubCloning(formattedGitHub,cmd,function(err,res){
                        if(err){
                            callback(err,null);
                            return;
                        }else{
                            callback(null,res);
                            return;
                        }
                    });
                }else if(formattedGitHub.repositoryType === 'Private' && formattedGitHub.authenticationType === 'userName') {
                    var cmd = 'curl -u '+formattedGitHub.repositoryUserName+':'+formattedGitHub.repositoryPassword + ' -L https://api.github.com/repos/'+formattedGitHub.repositoryOwner+'/'+formattedGitHub.repositoryName+'/tarball/'+formattedGitHub.repositoryBranch;
                    gitHubCloning(formattedGitHub,cmd,function(err,res){
                        if(err){
                            callback(err,null);
                            return;
                        }else{
                            callback(null,res);
                            return;
                        }
                    });
                }else if(formattedGitHub.repositoryType === 'Private' && formattedGitHub.authenticationType === 'sshKey') {
                    var cmd = 'curl -u '+formattedGitHub.repositoryUserName+':'+formattedGitHub.repositoryPassword + ' -L https://api.github.com/repos/'+formattedGitHub.repositoryOwner+'/'+formattedGitHub.repositoryName+'/tarball/'+formattedGitHub.repositoryBranch;
                    gitHubCloning(formattedGitHub,cmd,function(err,res){
                        if(err){
                            callback(err,null);
                            return;
                        }else{
                            callback(null,res);
                            return;
                        }
                    });
                }else{
                    var cmd = 'curl -L https://api.github.com/repos/'+formattedGitHub.repositoryOwner+'/'+formattedGitHub.repositoryName+'/tarball/'+formattedGitHub.repositoryBranch;
                    gitHubCloning(formattedGitHub,cmd,function(err,res){
                        if(err){
                            callback(err,null);
                            return;
                        }else{
                            callback(null,res);
                            return;
                        }
                    });
                }
            })
        }
    });
};

gitGubService.getGitHubList = function getGitHubList(query, callback) {
    var reqData = {};
    async.waterfall([
        function(next) {
            apiUtil.changeRequestForJqueryPagination(query, next);
        },
        function(filterQuery,next) {
            reqData = filterQuery;
            apiUtil.paginationRequest(filterQuery, 'gitHub', next);
        },
        function(paginationReq, next) {
            paginationReq['searchColumns'] = ['name', 'repositoryType', 'repositoryURL'];
            apiUtil.databaseUtil(paginationReq, next);
        },
        function(queryObj, next) {
            gitHubModel.getGitHubList(queryObj, next);
        },
        function(gitHubList, next) {
            if (gitHubList.docs.length > 0) {
                var formattedResponseList = [];
                for (var i = 0; i < gitHubList.docs.length; i++) {
                    formatGitHubResponse(gitHubList.docs[i],function(formattedData){
                        formattedResponseList.push(formattedData);
                        if (formattedResponseList.length === gitHubList.docs.length) {
                            gitHubList.docs = formattedResponseList;
                            next(null,gitHubList);
                        }
                    });
                }
            } else {
                next(null,gitHubList);
            }
        },
        function(formattedGitHubResponseList, next) {
            apiUtil.changeResponseForJqueryPagination(formattedGitHubResponseList, reqData, next);
        }
    ],function(err, results) {
        if (err){
            logger.error(err);
            callback(err,null);
            return;
        }
        callback(null,results)
        return;
    });
};

gitGubService.getGitHubById = function getGitHubById(gitHubId, callback) {
    gitHubModel.getGitHubById(gitHubId, function (err, gitHub) {
        if (err) {
            var err = new Error('Internal Server Error');
            err.status = 500;
            return callback(err);
        } else if (!gitHub) {
            var err = new Error('Git-Hub not found');
            err.status = 404;
            return callback(err);
        } else{
            formatGitHubResponse(gitHub,function(formattedData){
                callback(null, formattedData);
            });
        }
    });
};

function formatGitHubResponse(gitHub,callback) {
    var formatted = {
        _id:gitHub._id,
        repositoryName:gitHub.repositoryName,
        repositoryDesc:gitHub.repositoryDesc,
        repositoryOwner:gitHub.repositoryOwner,
        repositoryType:gitHub.repositoryType,
        repositoryBranch:gitHub.repositoryBranch
    };
    if (gitHub.organization.length) {
        formatted.orgId = gitHub.organization[0].rowid;
        formatted.orgName=gitHub.organization[0].orgname;
    }
    if (gitHub.repositoryType === 'Private' && gitHub.authenticationType === 'userName') {
        formatted.repositoryUserName = gitHub.repositoryUserName;
        formatted.authenticationType = gitHub.authenticationType;
        var cryptoConfig = appConfig.cryptoSettings;
        var cryptography = new Cryptography(cryptoConfig.algorithm, cryptoConfig.password);
        formatted.repositoryPassword =  cryptography.decryptText(gitHub.repositoryPassword, cryptoConfig.decryptionEncoding,
            cryptoConfig.encryptionEncoding);
        callback(formatted);
    }else if (gitHub.repositoryType === 'Private' && gitHub.authenticationType === 'sshKey') {
        formatted.authenticationType = gitHub.authenticationType;
        fileUpload.getReadStreamFileByFileId(gitHub.repositorySSHPublicKeyFileId,function(err,publicKeyFile){
            if(err){
                var err = new Error('Internal server error');
                err.status = 500;
                logger.error(err);
            }
            formatted.repositorySSHPublicKeyFileId = gitHub.repositorySSHPublicKeyFileId;
            formatted.repositorySSHPublicKeyFileName = publicKeyFile.fileName;
            formatted.repositorySSHPublicKeyFileData = publicKeyFile.fileData;
            fileUpload.getReadStreamFileByFileId(gitHub.repositorySSHPrivateKeyFileId,function(err,privateKeyFile){
                if(err){
                    var err = new Error('Internal server error');
                    err.status = 500;
                    logger.error(err);
                }
                formatted.repositorySSHPrivateKeyFileId = gitHub.repositorySSHPrivateKeyFileId;
                formatted.repositorySSHPrivateKeyFileName = privateKeyFile.fileName;
                formatted.repositorySSHPrivateKeyFileData = privateKeyFile.fileData;
                callback(formatted);
            });
        });
    }else if (gitHub.repositoryType === 'Private' && gitHub.authenticationType === 'token') {
        formatted.repositoryUserName = gitHub.repositoryUserName;
        formatted.authenticationType = gitHub.authenticationType;
        formatted.repositoryToken = gitHub.repositoryToken;
        callback(formatted);
    }else {
        formatted.authenticationType = gitHub.authenticationType;
        callback(formatted);
    }
}

function gitHubCloning(gitHubDetails,cmd,callback){
    var filePath = appConfig.currentDir + '/'+gitHubDetails.repositoryName+'.tgz';
    if(gitHubDetails.isRepoCloned && gitHubDetails.isRepoCloned === true) {
        fse.remove(filePath).then(function() {
            execCmd(cmd, function (err, out, code) {
                if (code === 0) {
                    fse.remove(appConfig.gitHubDir + gitHubDetails._id).then(function() {
                        targz.decompress({
                            src: filePath,
                            dest: appConfig.gitHubDir + gitHubDetails._id
                        }, function (err) {
                            if (err) {
                                logger.error("Error in Extracting Files ", err);
                                callback(err, null);
                            } else {
                                logger.debug("GIT Repository Clone is Done.");
                                callback(null, gitHubDetails);
                                botsNewService.syncBotsWithGitHub(gitHubDetails._id, function (err, data) {
                                    if (err) {
                                        logger.error("Error in Syncing GIT-Hub.", err);
                                    } else {
                                        logger.debug("Git Hub Sync is Done.");
                                    }
                                });
                            }
                        });
                    })
                }else{
                    var err = new Error('Invalid Git-Hub Credentials Details');
                    err.status = 400;
                    err.msg = 'Invalid Git-Hub Details';
                    callback(err, null);
                }
            });
        });
    }else {
        execCmd(cmd, function (err, out, code) {
            if (code === 0) {
                targz.decompress({
                    src: filePath,
                    dest: appConfig.gitHubDir + gitHubDetails._id
                }, function (err) {
                    if (err) {
                        logger.error("Error in Extracting Files ", err);
                        callback(err, null);
                    } else {
                        gitHubModel.updateGitHub(gitHubDetails._id, {isRepoCloned: true}, function (err, gitHub) {
                            if (err) {
                                logger.error(err);
                            }
                            logger.debug("GIT Repository Clone is Done.");
                            callback(null, gitHubDetails);
                            botsNewService.syncBotsWithGitHub(gitHubDetails._id, function (err, data) {
                                if (err) {
                                    logger.error("Error in Syncing GIT-Hub.", err);
                                } else {
                                    logger.debug("Git Hub Sync is Done.");
                                }
                            });
                        });
                    }
                });
            }else{
                var err = new Error('Invalid Git-Hub Credentials Details');
                err.status = 400;
                err.msg = 'Invalid Git-Hub Details';
                callback(err, null);
            }
        });
    }
}

